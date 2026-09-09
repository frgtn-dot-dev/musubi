import { readProviderRsvpInstance } from "./provider-rsvp-instance";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  BadRequestError,
  EventSchema,
  EventWriteError,
  ForbiddenError,
  EventTimeModelSchema, type EventTimeModel,
  ProviderEventStateSchema,
  ProviderRsvpEditSchema, providerRsvpDesiredState, type ProviderRsvpInstance, type ProviderRsvpEdit, type ProviderRsvpIntent, type Event,
} from "@musubi/types";
import { db } from "..";
import {
  calendarEvents,
  calendarMembers,
  events,
  eventOutbox,
  externalCalendars,
  externalEvents,
} from "../schema";
import { lockCalendarLifecycle } from "./calendar-lifecycle";
import { appendEventOutbox } from "./event-outbox";
import { providerStateVersion } from "./provider-reminders";
import { isDeepStrictEqual } from "node:util";
export type ProviderRsvpContext = { actorID: string; eventID: string; request: ProviderRsvpEdit; event: Event; mappingID: string; externalEventID: string; etag: string; accountID: string; externalCalendarID: string; linkID: string; state: import("@musubi/types").ProviderEventState; instance?: ProviderRsvpInstance };
export type ProviderRsvpReceipt = { operationID: string; replayed: boolean; status: string };
export type ProviderRsvpPreparation = { kind: "replay"; receipt: ProviderRsvpReceipt } | { kind: "prepared"; context: ProviderRsvpContext };
export async function prepareProviderRsvpEdit(actorID: string, eventID: string, input: unknown): Promise<ProviderRsvpPreparation> {
  return rsvpTransaction(actorID, eventID, input);
}
/** Internal staged capability. Public enqueue still uses the one-off entry. */
export async function prepareProviderRsvpInstanceEdit(actorID: string, eventID: string, input: unknown): Promise<ProviderRsvpPreparation> {
  return rsvpTransaction(actorID, eventID, input, undefined, true);
}
export async function commitProviderRsvpEdit(prepared: ProviderRsvpContext, baseline: Record<string, unknown>, nativeTime: EventTimeModel): Promise<ProviderRsvpReceipt> {
  const result = await rsvpTransaction(prepared.actorID, prepared.eventID, prepared.request, { context: prepared, baseline, nativeTime: EventTimeModelSchema.parse(nativeTime) }, !!prepared.instance);
  if (result.kind !== "replay") throw new Error("RSVP commit did not produce a receipt");
  return result.receipt;
}

/** Queue one personal provider change. No event content/revision, social action,
 * local notification or other destination changes as a side effect. */
async function rsvpTransaction(
  actorID: string,
  eventID: string,
  input: unknown,
  prepared?: { context: ProviderRsvpContext; baseline: Record<string, unknown>; nativeTime: EventTimeModel },
  allowInstance = false,
): Promise<ProviderRsvpPreparation> {
  const request = ProviderRsvpEditSchema.parse(input);
  eventID = eventID.toLowerCase();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["musubi:event-mutation", actorID, request.operationID])}, 0))`,
    );
    const [initial] = await tx
      .select({ calendarID: events.originCalendarID, seriesID: events.seriesID })
      .from(events)
      .where(eq(events.id, eventID));
    if (!initial?.calendarID)
      throw new ForbiddenError("A live connected source event is required.");
    await lockCalendarLifecycle(tx, [initial.calendarID], "shared");
    if (allowInstance && initial.seriesID)
      await tx.select({ id: events.id }).from(events).where(eq(events.id, initial.seriesID)).for("update");
    const [event] = await tx
      .select()
      .from(events)
      .where(and(eq(events.id, eventID), isNull(events.deletedAt)))
      .for("update");
    if (!event || event.originCalendarID !== initial.calendarID || (allowInstance && event.seriesID !== initial.seriesID))
      throw new ForbiddenError("The event source changed.");
    const [target] = await tx
      .select({ link: externalCalendars, role: calendarMembers.role })
      .from(externalCalendars)
      .innerJoin(
        calendarMembers,
        and(
          eq(calendarMembers.calendarID, externalCalendars.calendarID),
          eq(calendarMembers.userID, actorID),
        ),
      )
      .innerJoin(
        calendarEvents,
        and(
          eq(calendarEvents.calendarID, externalCalendars.calendarID),
          eq(calendarEvents.eventID, eventID),
        ),
      )
      .where(
        and(
          eq(externalCalendars.calendarID, initial.calendarID),
          eq(externalCalendars.userID, actorID),
          eq(externalCalendars.provider, request.provider),
          eq(externalCalendars.disabled, false),
          eq(externalCalendars.supportsEvents, true),
        ),
      )
      .for("share", { of: [calendarMembers, externalCalendars] });
    if (!target || !["owner", "editor"].includes(target.role))
      throw new ForbiddenError(
        "The connected source account must have write access.",
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
        previous.externalCalendarLinkID !== target.link.id ||
        previous.accountID !== target.link.accountID
      )
        throw new ForbiddenError(
          "The connected source changed since this operation.",
        );
      if (
        previous.eventID !== eventID ||
        JSON.stringify(
          previous.payload.rsvp?.request &&
            ProviderRsvpEditSchema.parse(previous.payload.rsvp?.request),
        ) !== JSON.stringify(request)
      )
        throw new BadRequestError(
          "This operation ID was already used for another request.",
        );
      return { kind: "replay", receipt: { operationID: previous.id, replayed: true, status: previous.status } };
    }
    // Native time/series evidence must be verified before accepting its ETag.
    if (event.timeModel?.kind === "floating" || event.recurrence || (!allowInstance && (event.seriesID || event.originalStart)) || event.isCanceled)
      throw new EventWriteError("event-write", "unsupported");
    const [mapping] = await tx
      .select()
      .from(externalEvents)
      .where(
        and(
          eq(externalEvents.eventID, eventID),
          eq(externalEvents.calendarID, initial.calendarID),
          eq(externalEvents.provider, request.provider),
          eq(externalEvents.externalCalendarID, target.link.externalCalendarID),
        ),
      )
      .for("update");
    if (
      !mapping?.etag ||
      mapping.etag.startsWith("W/") ||
      !mapping.providerState
    )
      throw new EventWriteError("event-write", "unsupported");
    const instance = allowInstance ? await readProviderRsvpInstance(tx, event, mapping, actorID) : undefined;
    if (
      event.revision !== request.expectedRevision ||
      providerStateVersion(mapping) !== request.expectedStateVersion
    )
      throw new BadRequestError(
        "Provider settings changed. Refresh before retrying.",
      );
    const pending = await tx
      .select({ id: eventOutbox.id })
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.eventID, eventID),
          eq(eventOutbox.calendarID, initial.calendarID),
          sql`${eventOutbox.status} not in ('completed', 'not-needed', 'cancelled')`,
        ),
      )
      .limit(1);
    if (pending.length)
      throw new BadRequestError(
        "This source has a pending operation. Reconcile it before changing provider RSVP.",
      );
    const [latest] = await tx
      .select({ status: eventOutbox.status })
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.eventID, eventID),
          eq(eventOutbox.calendarID, initial.calendarID),
          eq(eventOutbox.externalCalendarLinkID, target.link.id),
        ),
      )
      .orderBy(
        desc(eventOutbox.revision),
        desc(eventOutbox.createdAt),
        desc(eventOutbox.position),
      )
      .limit(1);
    if (latest?.status === "cancelled")
      throw new BadRequestError(
        "The previous source operation was cancelled. Reconcile delivery before changing provider RSVP.",
      );
    const links = await tx
      .select({ calendarID: calendarEvents.calendarID })
      .from(calendarEvents)
      .where(eq(calendarEvents.eventID, eventID));
    const snapshot = EventSchema.parse({
      ...event,
      calendars: links.map((link) => link.calendarID).sort(),
    });
    const state = ProviderEventStateSchema.parse(mapping.providerState);
    const desiredState = providerRsvpDesiredState(state, target.link.externalCalendarID, request.response);
    const context: ProviderRsvpContext = { actorID, eventID, request, event: snapshot, mappingID: mapping.id, externalEventID: mapping.externalEventID, etag: mapping.etag, accountID: target.link.accountID, externalCalendarID: target.link.externalCalendarID, linkID: target.link.id, state, ...(instance ? { instance } : {}) };
    if (!prepared) return { kind: "prepared", context };
    if (!isDeepStrictEqual(context, prepared.context)) throw new BadRequestError("RSVP source changed during provider verification.");
    // Raw evidence is server-internal and was normalized/compared by preflight.
    if (prepared.baseline.id !== mapping.externalEventID || prepared.baseline.etag !== mapping.etag)
      throw new BadRequestError("RSVP provider identity changed.");
    const rsvp: ProviderRsvpIntent = { request, baseline: prepared.baseline, nativeTime: prepared.nativeTime, ...(instance ? { instance } : {}), baselineState: state, desiredState, mappingID: mapping.id };
    const id = randomUUID();
    await appendEventOutbox(tx, snapshot, [
      {
        id,
        actorID,
        mutationID: request.operationID,
        position: 0,
        eventID,
        calendarID: initial.calendarID,
        externalCalendarLinkID: target.link.id,
        provider: request.provider,
        userID: actorID,
        accountID: target.link.accountID,
        externalCalendarID: target.link.externalCalendarID,
        externalEventID: mapping.externalEventID,
        expectedEtag: mapping.etag,
        icalUid: mapping.icalUid,
        action: "update",
        payload: { event: snapshot, rsvp },
      },
    ]);
    return { kind: "replay", receipt: { operationID: id, replayed: false, status: "pending" } };
  });
}

/** Recheck a claimed intent's exact live source before provider work. */
export async function hasProviderRsvpSource(row: import("./event-outbox").EventOutboxRow): Promise<boolean> {
  const intent = row.payload.rsvp;
  if (!intent || !row.leaseToken || row.provider !== "google" || row.action !== "update" || row.actorID !== row.userID) return false;
  const [source] = await db.select({ event: events, mapping: externalEvents, role: calendarMembers.role })
    .from(events)
    .innerJoin(eventOutbox, and(eq(eventOutbox.id, row.id), eq(eventOutbox.leaseToken, row.leaseToken), eq(eventOutbox.status, "attempting"), sql`${eventOutbox.leaseUntil} > clock_timestamp()`))
    .innerJoin(calendarEvents, and(eq(calendarEvents.eventID, events.id), eq(calendarEvents.calendarID, row.calendarID)))
    .innerJoin(calendarMembers, and(eq(calendarMembers.calendarID, row.calendarID), eq(calendarMembers.userID, row.actorID)))
    .innerJoin(externalCalendars, and(eq(externalCalendars.id, row.externalCalendarLinkID), eq(externalCalendars.calendarID, row.calendarID), eq(externalCalendars.userID, row.userID), eq(externalCalendars.accountID, row.accountID), eq(externalCalendars.provider, row.provider), eq(externalCalendars.externalCalendarID, row.externalCalendarID), eq(externalCalendars.disabled, false), eq(externalCalendars.supportsEvents, true)))
    .innerJoin(externalEvents, and(eq(externalEvents.id, intent.mappingID), eq(externalEvents.eventID, events.id), eq(externalEvents.calendarID, row.calendarID), eq(externalEvents.provider, row.provider), eq(externalEvents.externalCalendarID, row.externalCalendarID), eq(externalEvents.externalEventID, row.externalEventID!)))
    .where(and(eq(events.id, row.eventID), eq(events.originCalendarID, row.calendarID), isNull(events.deletedAt)));
  if (!source || !["owner", "editor"].includes(source.role) || source.event.revision !== row.revision || source.mapping.etag !== row.expectedEtag || providerStateVersion(source.mapping) !== intent.request.expectedStateVersion) return false;
  try {
    const current = await readProviderRsvpInstance(db, source.event, source.mapping, row.userID);
    return isDeepStrictEqual(current, intent.instance);
  } catch { return false; }
}

/** Opaque preview identity includes every native field, including unprojected
 * attendee comments. JSON object key ordering is not a provider edit. */
export function providerRsvpBaselineVersion(mappingID: string, baseline: Record<string, unknown>): string {
  function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, ordered(item)]));
    return value;
  }
  return createHash("sha256").update(JSON.stringify([mappingID, ordered(baseline)])).digest("hex");
}
