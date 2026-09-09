import { createHash } from "node:crypto";
import { readProviderRsvpInstance } from "./provider-rsvp-instance";
import { isDeepStrictEqual } from "node:util";
import { and, eq, isNull, sql } from "drizzle-orm";
import { config } from "@musubi/config";
import {
  BadRequestError,
  EventSchema,
  EventWriteError,
  OrganizerDispatchSchema,
  ProviderOrganizerRequestSchema,
  ProviderRsvpInstanceSchema,
  type ProviderRsvpInstance,
  type Event,
  type ProviderOrganizerIntent,
  type ProviderOrganizerRequest,
  type ProviderEventState,
} from "@musubi/types";
import { resolveEventTimeEdit } from "@musubi/calendar";
import { db } from "..";
import {
  account,
  caldavAccounts,
  calendars,
  calendarMembers,
  calendarEvents,
  events,
  externalCalendars,
  externalEvents,
  externalEventTombstones,
  eventOutbox,
} from "../schema";
import { lockCalendarLifecycle, lockUserLifecycle } from "./calendar-lifecycle";
import { lockExternalEventIdentity } from "./event-outbox-deletions";
import { appendEventOutbox, type EventOutboxRow } from "./event-outbox";
import { createEventInTransaction } from "./events";
import { providerStateVersion } from "./provider-reminders";
import { hasProviderSyncScopes } from "./oauth";
import type { DbTransaction } from "./calendars";
export type OrganizerContext = {
  actorID: string;
  request: ProviderOrganizerRequest;
  link: typeof externalCalendars.$inferSelect;
  event: Event | null;
  mapping: typeof externalEvents.$inferSelect | null;
  instance?: ProviderRsvpInstance;
};
function enabled(provider: string) {
  if (
    (provider === "google" || provider === "microsoft")
      ? !config.api.providerOrganizerEditsEnabled
      : provider === "caldav"
        ? !config.api.caldavOrganizerEditsEnabled
        : true
  )
    throw new EventWriteError("organizer", "unsupported");
}
function receipt(row: EventOutboxRow, replayed: boolean) {
  return {
    operationID: row.id,
    eventID: row.eventID,
    status: row.status,
    replayed,
    localCommitted: true as const,
    notificationDelivery: "unknown" as const,
  };
}
async function source(
  tx: DbTransaction,
  actorID: string,
  calendarID: string,
  provider?: string,
) {
  const [target] = await tx
    .select({ link: externalCalendars })
    .from(externalCalendars)
    .innerJoin(
      calendars,
      and(
        eq(calendars.id, externalCalendars.calendarID),
        eq(calendars.creatorID, actorID),
      ),
    )
    .innerJoin(
      calendarMembers,
      and(
        eq(calendarMembers.calendarID, externalCalendars.calendarID),
        eq(calendarMembers.userID, actorID),
        eq(calendarMembers.role, "owner"),
      ),
    )
    .where(
      and(
        eq(externalCalendars.calendarID, calendarID),
        eq(externalCalendars.userID, actorID),
        provider
          ? eq(externalCalendars.provider, provider)
          : sql`${externalCalendars.provider} in ('google', 'caldav', 'microsoft')`,
        eq(externalCalendars.disabled, false),
        eq(externalCalendars.supportsEvents, true),
      ),
    )
    .for("share", { of: [externalCalendars, calendars, calendarMembers] });
  if (!target) throw new EventWriteError("organizer", "denied");
  enabled(target.link.provider);
  if (target.link.provider === "caldav") {
    const [grant] = await tx
      .select()
      .from(caldavAccounts)
      .where(
        and(
          eq(caldavAccounts.id, target.link.accountID),
          eq(caldavAccounts.userID, actorID),
        ),
      )
      .for("share");
    if (!grant?.encryptedPassword)
      throw new EventWriteError("organizer", "denied");
    return target.link;
  }
  const [grant] = await tx
    .select()
    .from(account)
    .where(
      and(
        eq(account.userId, actorID),
        eq(account.providerId, target.link.provider),
        eq(account.accountId, target.link.accountID),
      ),
    )
    .for("share");
  if (
    !grant ||
    grant.syncStatus !== "active" ||
    !grant.refreshToken ||
    !hasProviderSyncScopes(target.link.provider, grant.scope ?? "")
  )
    throw new EventWriteError("organizer", "denied");
  return target.link;
}
function instanceVersion(instance: ProviderRsvpInstance) {
  return createHash("sha256")
    .update(JSON.stringify(ProviderRsvpInstanceSchema.parse(instance)))
    .digest("hex");
}
/** Read-only observation helper; admission rechecks this opaque parent/slot token. */
export async function readProviderOrganizerInstanceVersion(
  actorID: string,
  eventID: string,
) {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(events)
      .where(eq(events.id, eventID));
    if (!event?.originCalendarID) return undefined;
    await source(tx, actorID, event.originCalendarID);
    const maps = await tx
      .select()
      .from(externalEvents)
      .where(
        and(
          eq(externalEvents.eventID, eventID),
          eq(externalEvents.calendarID, event.originCalendarID),
        ),
      );
    if (maps.length !== 1) return undefined;
    const instance = await readProviderRsvpInstance(
      tx,
      event,
      maps[0]!,
      actorID,
    );
    return instance ? instanceVersion(instance) : undefined;
  });
}
/** Match the parent's generation before locking the child, consistently with scope writes. */
async function lockOrganizerParent(
  tx: DbTransaction,
  eventID: string,
  expectedParentID?: string,
) {
  const [before] = await tx
    .select({ seriesID: events.seriesID })
    .from(events)
    .where(eq(events.id, eventID));
  const parentID = expectedParentID ?? before?.seriesID;
  if (parentID) {
    await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, parentID))
      .for("update");
    // Retain the exact mapping/link generation through dispatch marker commit;
    // a plain joined read alone would permit concurrent mapping replacement.
    await tx
      .select({ id: externalEvents.id })
      .from(externalEvents)
      .where(eq(externalEvents.eventID, parentID))
      .orderBy(externalEvents.id)
      .for("share");
    await tx
      .select({ calendarID: calendarEvents.calendarID })
      .from(calendarEvents)
      .where(eq(calendarEvents.eventID, parentID))
      .orderBy(calendarEvents.calendarID)
      .for("share");
  }
  return parentID;
}
export async function prepareProviderOrganizer(
  actorID: string,
  input: unknown,
  prepared?: {
    context: OrganizerContext;
    graphIdentity?: ProviderOrganizerIntent["graphIdentity"];
    baseline: Record<string, unknown> | null;
    desired: Record<string, unknown> | null;
  },
): Promise<
  | { kind: "prepared"; context: OrganizerContext }
  | { kind: "saved"; receipt: ReturnType<typeof receipt> }
> {
  const request = ProviderOrganizerRequestSchema.parse(input);
  enabled(request.provider);
  return db.transaction(async (tx) => {
    await lockUserLifecycle(tx, [actorID], "shared");
    await lockCalendarLifecycle(tx, [request.calendarID], "shared");
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["musubi:event-mutation", actorID, request.operationID])}, 0))`,
    );
    const link = await source(
      tx,
      actorID,
      request.calendarID,
      request.provider,
    );
    const [previous] = await tx
      .select()
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.actorID, actorID),
          eq(eventOutbox.mutationID, request.operationID),
        ),
      )
      .for("update");
    if (previous) {
      if (
        previous.externalCalendarLinkID !== link.id ||
        !isDeepStrictEqual(previous.payload.organizer?.request, request)
      )
        throw new BadRequestError(
          "This operation identity already belongs to a different request.",
        );
      return { kind: "saved", receipt: receipt(previous, true) };
    }
    const lockedParentID = await lockOrganizerParent(tx, request.eventID);
    const [current] = await tx
      .select()
      .from(events)
      .where(eq(events.id, request.eventID))
      .for("update");
    let event: Event | null = null,
      mapping: typeof externalEvents.$inferSelect | null = null;
    let instance: ProviderRsvpInstance | undefined;
    if (request.action === "create") {
      if (current)
        throw new BadRequestError("This event identity already exists.");
    } else {
      if (
        !current ||
        current.deletedAt ||
        current.originCalendarID !== request.calendarID ||
        current.isCanceled ||
        (current.seriesID !== lockedParentID &&
          (current.seriesID || lockedParentID)) ||
        current.recurrence ||
        current.revision !== request.expectedRevision
      )
        throw new BadRequestError(
          "The source event changed. Refresh before saving.",
        );
      const links = await tx
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.eventID, request.eventID))
        .for("share");
      // This first organizer contract cannot fan out private meeting edits to shares.
      if (links.length !== 1 || links[0]!.calendarID !== request.calendarID)
        throw new EventWriteError("organizer", "unsupported");
      event = EventSchema.parse({
        ...current,
        calendars: [request.calendarID],
      });
      const maps = await tx
        .select()
        .from(externalEvents)
        .where(
          and(
            eq(externalEvents.eventID, request.eventID),
            eq(externalEvents.calendarID, request.calendarID),
          ),
        )
        .for("update");
      mapping = maps[0] ?? null;
      if (
        maps.length !== 1 ||
        !mapping?.etag ||
        mapping.provider !== request.provider ||
        mapping.externalCalendarID !== link.externalCalendarID ||
        providerStateVersion(mapping) !== request.expectedStateVersion
      )
        throw new BadRequestError("Provider source changed. Sync and reopen.");
      instance = await readProviderRsvpInstance(tx, current, mapping!, actorID);
      if (
        !!instance !== (request.provider === "google" && request.scope === "occurrence") ||
        (instance &&
          (request.provider !== "google" || instanceVersion(instance) !== request.expectedInstanceVersion))
      )
        throw new BadRequestError(
          "The parent or occurrence binding changed. Sync and reopen.",
        );
      const [pending] = await tx
        .select({ id: eventOutbox.id })
        .from(eventOutbox)
        .where(
          and(
            eq(eventOutbox.eventID, request.eventID),
            sql`${eventOutbox.status} not in ('completed', 'not-needed')`,
          ),
        )
        .limit(1);
      if (pending)
        throw new BadRequestError("Reconcile the previous operation first.");
    }
    const context: OrganizerContext = {
      actorID,
      request,
      link,
      event,
      mapping,
      ...(instance ? { instance } : {}),
    };
    if (!prepared) return { kind: "prepared", context };
    if (!isDeepStrictEqual(context, prepared.context))
      throw new BadRequestError("Source changed during provider verification.");
    if (
      request.action !== "create" &&
      (prepared.baseline?.id !== mapping!.externalEventID ||
        prepared.baseline?.etag !== mapping!.etag)
    )
      throw new BadRequestError("Native source version changed.");
    if (request.provider === "microsoft" && (!prepared.graphIdentity || prepared.graphIdentity.oauthAccountID !== link.accountID || prepared.graphIdentity.calendarID !== link.externalCalendarID || !prepared.graphIdentity.graphUserID || !prepared.graphIdentity.selfAddress))
      throw new BadRequestError("Verified Graph identity is required.");
    enabled(request.provider);
    let saved: Event;
    if (request.action === "create") {
      const created = await createEventInTransaction(
        tx,
        {
          id: request.eventID,
          creatorID: actorID,
          organizer: actorID,
          title: request.content.title,
          description: request.content.description,
          location: request.content.location,
          color: request.color,
          ...resolveEventTimeEdit(request.time),
          recurrence: null,
          hasAttendees: false,
          isCanceled: false,
          originCalendarID: request.calendarID,
        },
        [request.calendarID],
      );
      saved = EventSchema.parse({
        ...created,
        calendars: [request.calendarID],
      });
    } else {
      const patch =
        request.action === "delete"
          ? { isCanceled: true }
          : {
              ...(request.patch.title !== undefined
                ? { title: request.patch.title }
                : {}),
              ...(request.patch.description !== undefined
                ? { description: request.patch.description }
                : {}),
              ...(request.patch.location !== undefined
                ? { location: request.patch.location }
                : {}),
              ...("time" in request.patch && request.patch.time
                ? resolveEventTimeEdit(request.patch.time)
                : {}),
            };
      const [updated] = await tx
        .update(events)
        .set({
          ...patch,
          revision: sql`${events.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(events.id, request.eventID))
        .returning();
      saved = EventSchema.parse({
        ...updated,
        calendars: [request.calendarID],
      });
    }
    const organizer: ProviderOrganizerIntent = {
      request,
      ...(request.provider === "microsoft" ? { graphIdentity: prepared.graphIdentity } : {}),
      baseline: prepared.baseline,
      desired: prepared.desired,
      mappingID: mapping?.id ?? null,
      sourceEvent: event ?? saved,
      ...(instance ? { instance } : {}),
      ...(request.provider === "microsoft" ? { sourceAccessRevision: link.providerAccessRevision } : {}),
    };
    await appendEventOutbox(tx, saved, [
      {
        id: request.operationID,
        actorID,
        mutationID: request.operationID,
        position: 0,
        eventID: saved.id,
        calendarID: request.calendarID,
        externalCalendarLinkID: link.id,
        provider: request.provider,
        userID: actorID,
        accountID: link.accountID,
        externalCalendarID: link.externalCalendarID,
        externalEventID: mapping?.externalEventID ?? null,
        expectedEtag: mapping?.etag ?? null,
        icalUid: mapping?.icalUid ?? null,
        action: request.action,
        payload: {
          event: saved,
          organizer,
          ...(request.action === "create"
            ? { createIdentityVersion: 1 as const }
            : {}),
        },
      },
    ]);
    const [row] = await tx
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.id, request.operationID));
    return { kind: "saved", receipt: receipt(row!, false) };
  });
}
/** Caller holds user/calendar fences before event/outbox locks. */
async function activeSource(tx: DbTransaction, row: EventOutboxRow) {
  enabled(row.provider);
  const intent = row.payload.organizer;
  if (
    !intent ||
    row.actorID !== row.userID ||
    !["google", "caldav", "microsoft"].includes(row.provider) ||
    intent.request.provider !== row.provider ||
    (intent.dispatch &&
      intent.dispatch.kind !== `${row.provider}-organizer-dispatch`) ||
    intent.request.action !== row.action
  )
    throw new EventWriteError("organizer", "unsupported");
  const link = await source(tx, row.userID, row.calendarID, row.provider);
  if (
    (row.provider === "microsoft" && intent.sourceAccessRevision !== link.providerAccessRevision) ||
    link.id !== row.externalCalendarLinkID ||
    link.accountID !== row.accountID ||
    link.externalCalendarID !== row.externalCalendarID
  )
    throw new EventWriteError("organizer", "denied");
  const [event] = await tx
    .select()
    .from(events)
    .where(eq(events.id, row.eventID))
    .for("update");
  const tombstone = intent.dispatch?.cancellationTombstone;
  const provenCancellation =
    row.action === "delete" &&
    !!intent.dispatch?.acceptedAt &&
    !!tombstone &&
    event?.isCanceled === true &&
    event.revision === tombstone.revision &&
    event.revision === row.revision + 1 &&
    event.deletedAt?.toISOString() === tombstone.deletedAt;
  const links = await tx
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.eventID, row.eventID))
    .for("share");
  if (
    !event ||
    (!provenCancellation &&
      (event.deletedAt !== null || event.revision !== row.revision)) ||
    event.originCalendarID !== row.calendarID ||
    links.length !== 1 ||
    links[0]!.calendarID !== row.calendarID
  )
    throw new BadRequestError("Organizer source changed.");
  const maps = await tx
    .select()
    .from(externalEvents)
    .where(
      and(
        eq(externalEvents.eventID, row.eventID),
        eq(externalEvents.calendarID, row.calendarID),
      ),
    )
    .for("update");
  const map = maps[0];
  if (
    intent.mappingID
      ? maps.length !== 1 ||
        map?.id !== intent.mappingID ||
        map.etag !== row.expectedEtag ||
        map.externalEventID !== row.externalEventID
      : maps.length !== 0
  )
    throw new BadRequestError("Organizer mapping changed.");
  if (intent.instance) {
    if (
      !map ||
      event.seriesID !== intent.instance.seriesID ||
      !isDeepStrictEqual(event.originalStart, intent.instance.originalStart)
    )
      throw new BadRequestError("Organizer occurrence identity changed.");
    // Only this exact own cancellation revision may retain the active slot proof
    // after local cancellation. RSVP's active-child admission stays unchanged.
    const bindingEvent =
      row.action === "delete"
        ? { ...event, isCanceled: false, deletedAt: null }
        : event;
    const currentInstance = await readProviderRsvpInstance(
      tx,
      bindingEvent,
      map,
      row.userID,
    );
    if (!isDeepStrictEqual(currentInstance, intent.instance))
      throw new BadRequestError("Organizer parent changed.");
  } else if (
    event.seriesID ||
    event.originalStart ||
    map?.externalSeriesID ||
    map?.originalStart
  )
    throw new BadRequestError("Organizer occurrence requires explicit scope.");
}
export async function withProviderOrganizerLease<T>(
  row: EventOutboxRow,
  action: (tx: DbTransaction, current: EventOutboxRow) => Promise<T>,
  nativeIdentity?: string,
) {
  return db.transaction(async (tx) => {
    await lockUserLifecycle(tx, [row.userID], "shared");
    await lockCalendarLifecycle(tx, [row.calendarID], "shared");
    const identity =
      row.externalEventID ?? (row.provider === "microsoft" ? nativeIdentity ?? `transaction:${row.id}` : String(row.payload.organizer!.desired?.id ?? ""));
    if (!identity)
      throw new BadRequestError("Organizer native identity is unavailable.");
    await lockExternalEventIdentity(tx, row.externalCalendarLinkID, identity);
    await lockOrganizerParent(
      tx,
      row.eventID,
      row.payload.organizer?.instance?.seriesID,
    );
    await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, row.eventID))
      .for("update");
    const [current] = await tx
      .select()
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.id, row.id),
          eq(eventOutbox.status, "attempting"),
          eq(eventOutbox.leaseToken, row.leaseToken!),
          sql`${eventOutbox.leaseUntil} > clock_timestamp()`,
        ),
      )
      .for("update");
    if (
      !current ||
      !isDeepStrictEqual(
        { ...current.payload.organizer, dispatch: undefined },
        { ...row.payload.organizer, dispatch: undefined },
      ) ||
      !isDeepStrictEqual(current.payload.event, row.payload.event)
    )
      throw new BadRequestError("Organizer lease changed.");
    await activeSource(tx, current);
    return action(tx, current);
  });
}
export async function markProviderOrganizer(
  row: EventOutboxRow,
  accepted = false,
) {
  return withProviderOrganizerLease(row, async (tx, current) => {
    const intent = current.payload.organizer!;
    if (!accepted && intent.dispatch)
      throw new BadRequestError("Organizer dispatch was already marked.");
    const dispatch = accepted
      ? {
          ...OrganizerDispatchSchema.parse(intent.dispatch),
          acceptedAt: new Date().toISOString(),
        }
      : OrganizerDispatchSchema.parse({
          kind:
            row.provider === "caldav"
              ? "caldav-organizer-dispatch"
              : row.provider === "microsoft" ? "microsoft-organizer-dispatch" : "google-organizer-dispatch",
          version: 1,
          startedAt: new Date().toISOString(),
        });
    enabled(row.provider);
    await tx
      .update(eventOutbox)
      .set({
        payload: { ...current.payload, organizer: { ...intent, dispatch } },
        uncertain: true,
      })
      .where(eq(eventOutbox.id, current.id));
  });
}
export async function completeProviderOrganizer(
  row: EventOutboxRow,
  native: {
    id: string;
    etag: string;
    iCalUID: string;
    state: ProviderEventState;
  } | null,
) {
  return withProviderOrganizerLease(row, async (tx, current) => {
    const intent = current.payload.organizer!;
    if (current.action === "delete" && (!intent.dispatch?.acceptedAt || native))
      throw new BadRequestError("Cancellation acceptance is unavailable.");
    if (current.action !== "delete" && !native)
      throw new BadRequestError("Native confirmation is unavailable.");
    const id = native?.id ?? current.externalEventID!;
    await lockExternalEventIdentity(tx, current.externalCalendarLinkID, id);
    if (
      current.remoteSnapshot &&
      (current.remoteSnapshot.externalEventId !== id ||
        (current.action !== "delete" &&
          current.remoteSnapshot.etag !== native?.etag))
    )
      throw new BadRequestError("A different provider observation is pending.");
    if (
      current.action === "delete" &&
      current.remoteSnapshot &&
      !current.remoteSnapshot.deleted &&
      current.remoteSnapshot.etag !== current.expectedEtag
    )
      throw new BadRequestError("Provider copy changed during cancellation.");
    if (native) {
      const [removed] = await tx
        .select()
        .from(externalEventTombstones)
        .where(
          and(
            eq(
              externalEventTombstones.externalCalendarLinkID,
              current.externalCalendarLinkID,
            ),
            eq(externalEventTombstones.externalEventID, id),
          ),
        );
      if (removed) throw new BadRequestError("Provider identity was removed.");
      const metadata = {
        etag: native.etag,
        icalUid: native.iCalUID,
        providerState: native.state,
        providerStateObservedAt: new Date(),
      };
      if (intent.mappingID)
        await tx
          .update(externalEvents)
          .set(metadata)
          .where(eq(externalEvents.id, intent.mappingID));
      else
        await tx.insert(externalEvents).values({
          eventID: current.eventID,
          calendarID: current.calendarID,
          provider: current.provider,
          externalCalendarID: current.externalCalendarID,
          externalEventID: native.id,
          ...metadata,
        });
    } else
      await tx
        .insert(externalEventTombstones)
        .values({
          externalCalendarLinkID: current.externalCalendarLinkID,
          externalEventID: id,
        })
        .onConflictDoNothing();
    await tx
      .update(eventOutbox)
      .set({
        ...(current.provider === "microsoft" && native ? { externalEventID: native.id } : {}),
        status: intent.dispatch ? "completed" : "not-needed",
        errorCode: null,
        uncertain: false,
        leaseToken: null,
        leaseUntil: null,
        remoteSnapshot: null,
        resultRef: native
          ? {
              externalEventId: native.id,
              etag: native.etag,
              icalUid: native.iCalUID,
            }
          : null,
      })
      .where(eq(eventOutbox.id, current.id));
  }, native?.id);
}
export async function readProviderOrganizerCalendar(
  actorID: string,
  calendarID: string,
) {
  if (
    !config.api.providerOrganizerEditsEnabled &&
    !config.api.caldavOrganizerEditsEnabled
  )
    throw new EventWriteError("organizer", "unsupported");
  return db.transaction(async (tx) => {
    await lockUserLifecycle(tx, [actorID], "shared");
    await lockCalendarLifecycle(tx, [calendarID], "shared");
    return source(tx, actorID, calendarID);
  });
}

/** Continue reading explicit organizer time only for a persisted, exact source.
 * This read capability survives disabling organizer writes; unrelated imports
 * retain their existing legacy normalization and edit path. */
export async function getOrganizerTimeEventIDs(
  userID: string,
  accountID: string,
  externalCalendarID: string,
  provider: "google" | "caldav" | "microsoft" = "google",
): Promise<string[]> {
  const rows = await db
    .select({
      externalID: eventOutbox.externalEventID,
      request: sql<unknown>`${eventOutbox.payload}->'organizer'->'request'`,
    })
    .from(eventOutbox)
    .innerJoin(
      externalCalendars,
      and(
        eq(externalCalendars.id, eventOutbox.externalCalendarLinkID),
        eq(externalCalendars.calendarID, eventOutbox.calendarID),
        eq(externalCalendars.userID, eventOutbox.userID),
        eq(externalCalendars.accountID, eventOutbox.accountID),
        eq(
          externalCalendars.externalCalendarID,
          eventOutbox.externalCalendarID,
        ),
      ),
    )
    .innerJoin(
      events,
      and(
        eq(events.id, eventOutbox.eventID),
        eq(events.originCalendarID, eventOutbox.calendarID),
      ),
    )
    .where(
      and(
        eq(eventOutbox.provider, provider),
        eq(externalCalendars.provider, provider),
        eq(eventOutbox.userID, userID),
        eq(eventOutbox.actorID, userID),
        eq(eventOutbox.accountID, accountID),
        eq(eventOutbox.externalCalendarID, externalCalendarID),
        eq(externalCalendars.disabled, false),
        sql`${eventOutbox.payload}->'organizer' is not null`,
        sql`${events.timeModel}->>'kind' in ('zoned', 'all-day')`,
      ),
    );
  return [
    ...new Set(
      rows.flatMap((row) => {
        const parsed = ProviderOrganizerRequestSchema.safeParse(row.request);
        if (!parsed.success) return [];
        return row.externalID
          ? [row.externalID]
          : parsed.data.action === "create" && parsed.data.provider !== "microsoft"
            ? [
                parsed.data.provider === "google"
                  ? `musubi${parsed.data.operationID.replace(/-/g, "")}`
                  : `${externalCalendarID.endsWith("/") ? externalCalendarID : `${externalCalendarID}/`}musubi-${parsed.data.operationID}.ics`,
              ]
            : [];
      }),
    ),
  ];
}

export const getGoogleOrganizerTimeEventIDs = getOrganizerTimeEventIDs;
