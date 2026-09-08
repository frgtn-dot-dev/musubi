import { providerRsvpBaselineVersion } from "./provider-rsvp";
import { isDeepStrictEqual } from "node:util";
import { providerStateVersion } from "./provider-reminders";
import { matchesReminderEventProjection } from "./event-outbox-projection";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  EventSchema,
  EventWriteError,
  NotFoundError,
  type ResolveEventDeliveryRequest,
  type ProviderReminderEdit,
  type ProviderRsvpIntent,
  ProviderRsvpEditSchema, providerRsvpDesiredState,
  type ProviderEventState,
} from "@musubi/types";
import { db } from "..";
import {
  events,
  eventOutbox,
  externalEvents,
  externalEventTombstones,
  calendarEvents,
  calendarMembers,
} from "../schema";
import {
  assertEventDeliveryDestination,
  EventDeliveryRetryError,
} from "./event-delivery-retry";
import {
  eventOutboxCreatedAt,
  unresolvedEventOutbox,
  type EventOutboxRow,
} from "./event-outbox";
import { caldavSeriesContext, sameCaldavScopeContext, type CaldavSeriesContext, type CaldavSeriesPrepared } from "./caldav-series-scope";
import type { GoogleOccurrenceIntent } from "./google-occurrence-scope";
import type { DbTransaction } from "./calendars";
import type { EventContentPatch } from "./events";
import type { EventDeliveryRef } from "./event-outbox-delivery";
import { lockCalendarLifecycle } from "./calendar-lifecycle";
import { lockExternalEventIdentity } from "./event-outbox-deletions";

export class EventDeliveryResolutionError extends Error {
  constructor(
    readonly code: "delivery-state-changed" | "delivery-resolution-unavailable",
  ) {
    super(
      "Delivery changed or cannot be resolved with this preview. Refresh before confirming.",
    );
    this.name = "EventDeliveryResolutionError";
  }
}

async function resolutionContext(
  tx: DbTransaction,
  userID: string,
  eventID: string,
  operationID: string,
) {
  const [row] = await tx
    .select()
    .from(eventOutbox)
    .where(
      and(
        eq(eventOutbox.id, operationID),
        eq(eventOutbox.eventID, eventID),
        eq(eventOutbox.userID, userID),
      ),
    );
  if (!row) throw new NotFoundError("Delivery operation not found.");
  await assertEventDeliveryDestination(tx, row, userID);
  const target = and(
    eq(eventOutbox.eventID, eventID),
    eq(eventOutbox.externalCalendarLinkID, row.externalCalendarLinkID),
  );
  const [latest] = await tx
    .select()
    .from(eventOutbox)
    .where(target)
    .orderBy(
      desc(eventOutbox.revision),
      desc(eventOutbox.createdAt),
      desc(eventOutbox.position),
      desc(eventOutbox.id),
    )
    .limit(1);
  const pending = await tx
    .select()
    .from(eventOutbox)
    .where(and(target, unresolvedEventOutbox()))
    .orderBy(
      asc(eventOutbox.revision),
      asc(eventOutbox.createdAt),
      asc(eventOutbox.position),
      asc(eventOutbox.id),
    )
    .limit(1001);
  const head = pending[0] ?? latest;
  if (
    row.id !== head.id ||
    !["conflict", "blocked", "cancelled", "unconfirmed"].includes(row.status)
  )
    throw new EventDeliveryResolutionError("delivery-state-changed");
  if (
    pending.length > 1000 ||
    pending.some((item) => item.status === "attempting")
  )
    throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
  const current = await tx.query.events.findFirst({
    where: (table, { eq }) => eq(table.id, eventID),
    with: { calendarEvents: true },
  });
  // An owner of retained receipts must not see later private edits after unlink.
  const linked =
    current &&
    !current.deletedAt &&
    current.calendarEvents.some((link) => link.calendarID === row.calendarID);
  const local = EventSchema.parse(
    linked
      ? {
          ...current,
          calendars: current.calendarEvents.map((link) => link.calendarID),
        }
      : latest.payload.event,
  );
  const mappings = await tx
    .select()
    .from(externalEvents)
    .where(
      and(
        eq(externalEvents.eventID, eventID),
        eq(externalEvents.calendarID, row.calendarID),
        eq(externalEvents.provider, row.provider),
      ),
    );
  if (mappings.length > 1)
    throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
  const [mapping] = mappings;
  if (!row.payload.rsvp && (latest.payload.rsvp || pending.some(item => item.payload.rsvp))) throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
  if (row.payload.rsvp && (row.payload.reminderEdit || row.payload.googleOccurrence || row.payload.caldavSeries || local.recurrence || local.seriesID || local.originalStart || local.isCanceled || local.timeModel?.kind === "floating")) throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
  if (row.payload.reminderEdit || row.payload.rsvp) {
    const [membership] = await tx.select({ role: calendarMembers.role }).from(calendarMembers).where(and(eq(calendarMembers.calendarID, row.calendarID), eq(calendarMembers.userID, userID)));
    if (row.provider !== "google" || row.action !== "update" || row.actorID !== userID || !linked || current.originCalendarID !== row.calendarID || latest.id !== row.id || pending.some(item => item.id !== row.id) || !membership || !["owner", "editor"].includes(membership.role) || !mapping || mapping.externalEventID !== row.externalEventID || mapping.externalCalendarID !== row.externalCalendarID || !mapping.providerState || local.revision !== row.revision || !matchesReminderEventProjection("google", EventSchema.parse(row.payload.event), local))
      throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
  } else if (latest.payload.reminderEdit || pending.some(item => item.payload.reminderEdit)) {
    throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
  }
  let caldavContext: CaldavSeriesContext | undefined;
  if (row.payload.caldavSeries) {
    if (row.provider !== "caldav" || row.action !== "update" || !linked || latest.id !== row.id || pending.some(item => item.id !== row.id))
      throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const childRows = await tx.query.events.findMany({ where: eq(events.seriesID, eventID), with: { calendarEvents: true }, orderBy: events.id });
    if (childRows.some(child => child.deletedAt)) throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    try {
      caldavContext = await caldavSeriesContext(tx, userID, local, childRows.map(child => EventSchema.parse({ ...child, calendars: child.calendarEvents.map(link => link.calendarID).sort() })), row.id, true);
    } catch (error) {
      if (error instanceof EventWriteError) throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
      throw error;
    }
    const expected = { ...row.payload.caldavSeries.context, master: EventSchema.parse(row.payload.event) };
    if (!sameCaldavScopeContext(caldavContext, expected)) throw new EventDeliveryResolutionError("delivery-state-changed");
  } else if (latest.payload.caldavSeries || pending.some(item => item.payload.caldavSeries)) {
    throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
  }
  let masterRevision: number | undefined;
  if (row.payload.googleOccurrence) {
    const intent = row.payload.googleOccurrence;
    const master = await tx.query.events.findFirst({
      where: (table, { eq }) => eq(table.id, intent.master.id),
    });
    const family = await tx
      .select({ id: events.id, calendarID: calendarEvents.calendarID })
      .from(events)
      .leftJoin(calendarEvents, eq(calendarEvents.eventID, events.id))
      .where(
        or(
          eq(events.id, intent.master.id),
          eq(events.seriesID, intent.master.id),
        ),
      );
    const [masterMapping] = await tx
      .select()
      .from(externalEvents)
      .where(
        and(
          eq(externalEvents.eventID, intent.master.id),
          eq(externalEvents.calendarID, row.calendarID),
          eq(externalEvents.provider, "google"),
        ),
      );
    if (
      row.provider !== "google" ||
      row.action !== "update" ||
      !linked ||
      latest.id !== row.id ||
      pending.some((item) => item.id !== row.id) ||
      !master ||
      master.deletedAt ||
      master.revision !== intent.master.revision ||
      family.some((item) => item.calendarID !== row.calendarID) ||
      !masterMapping ||
      masterMapping.externalEventID !== intent.masterExternalID ||
      masterMapping.etag !== intent.masterEtag ||
      local.seriesID !== master.id ||
      JSON.stringify(local.originalStart) !==
        JSON.stringify(EventSchema.parse(row.payload.event).originalStart) ||
      !mapping ||
      mapping.externalEventID !== row.externalEventID ||
      mapping.externalSeriesID !== intent.masterExternalID
    )
      throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    masterRevision = master.revision;
  } else if (
    latest.payload.googleOccurrence ||
    pending.some((item) => item.payload.googleOccurrence)
  ) {
    throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
  }
  return {
    masterRevision,
    caldavContext,
    row,
    latest,
    pending: pending.length ? pending : [row],
    local,
    localRevision: linked ? current.revision : null,
    deleted: !linked,
    mapping,
  };
}

export type EventDeliveryResolutionContext = Awaited<
  ReturnType<typeof resolutionContext>
>;

export async function getEventDeliveryResolutionContext(
  userID: string,
  eventID: string,
  operationID: string,
) {
  return db.transaction(
    (tx) => resolutionContext(tx, userID, eventID, operationID),
    {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    },
  );
}

export type EventDeliveryResolutionProof = {
  context: EventDeliveryResolutionContext;
  ref: EventDeliveryRef | null;
  remoteExists: boolean;
  action: EventOutboxRow["action"];
  patch: EventContentPatch;
  googleOccurrence?: GoogleOccurrenceIntent;
  caldavSeries?: CaldavSeriesPrepared;
  rsvp?: { intent: ProviderRsvpIntent; baselineVersion: string };
  reminder?: { intent: ProviderReminderEdit; state: ProviderEventState; stateVersion: string };
  deletion: typeof externalEventTombstones.$inferSelect | undefined;
};

function sameResolution(
  row: EventOutboxRow,
  eventID: string,
  operationID: string,
  request: ResolveEventDeliveryRequest,
) {
  const accepted = row.payload.resolution;
  return (
    row.eventID === eventID &&
    accepted?.operationID === operationID &&
    accepted.expectedLocalRevision === request.expectedLocalRevision &&
    accepted.expectedLatestOperationID === request.expectedLatestOperationId &&
    accepted.expectedRemoteExists === request.expectedRemoteExists &&
    accepted.expectedRemoteEtag === request.expectedRemoteEtag &&
    accepted.expectedMasterRevision === request.expectedMasterRevision &&
    accepted.expectedReminderStateVersion === request.expectedReminderStateVersion &&
    accepted.expectedRsvpBaselineVersion === request.expectedRsvpBaselineVersion
  );
}

export async function getEventDeliveryResolutionReplay(
  userID: string,
  eventID: string,
  operationID: string,
  request: ResolveEventDeliveryRequest,
) {
  const [row] = await db
    .select()
    .from(eventOutbox)
    .where(
      and(
        eq(eventOutbox.actorID, userID),
        eq(eventOutbox.mutationID, request.mutationId),
        eq(eventOutbox.position, 0),
      ),
    );
  if (!row) return undefined;
  if (
    row.userID !== userID ||
    !sameResolution(row, eventID, operationID, request)
  )
    throw new EventDeliveryResolutionError("delivery-state-changed");
  return row.id;
}

/** The user confirms the latest saved target state, not each obsolete queued
 * intermediate edit. Archive that unresolved chain and append one explicit
 * replacement intent. Mapping baseline, tombstone CAS and supersession commit
 * together, after fresh provider evidence and without provider I/O in this tx. */
export async function commitEventDeliveryResolution(
  userID: string,
  proof: EventDeliveryResolutionProof,
  request: ResolveEventDeliveryRequest,
) {
  const { row } = proof.context;
  try {
    return await db.transaction(async (tx) => {
      await lockCalendarLifecycle(tx, [row.calendarID], "shared");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
        ${JSON.stringify(["musubi:event-mutation", userID, request.mutationId.toLowerCase()])}, 0))`);
      const [replay] = await tx
        .select()
        .from(eventOutbox)
        .where(
          and(
            eq(eventOutbox.actorID, userID),
            eq(eventOutbox.mutationID, request.mutationId),
            eq(eventOutbox.position, 0),
          ),
        );
      if (replay) {
        if (
          replay.userID !== userID ||
          !sameResolution(replay, row.eventID, row.id, request)
        )
          throw new EventDeliveryResolutionError("delivery-state-changed");
        return replay.id;
      }
      if (proof.ref)
        await lockExternalEventIdentity(
          tx,
          row.externalCalendarLinkID,
          proof.ref.externalEventId,
        );
      if (row.payload.googleOccurrence)
        await tx
          .select({ id: events.id })
          .from(events)
          .where(eq(events.id, row.payload.googleOccurrence.master.id))
          .for("update");
      await tx
        .select({ id: events.id })
        .from(events)
        .where(eq(events.id, row.eventID))
        .for("update");
      if (row.payload.caldavSeries) {
        await tx.select({ id: events.id }).from(events).where(eq(events.seriesID, row.eventID)).orderBy(events.id).for("update");
        await tx.select({ id: externalEvents.id }).from(externalEvents).where(and(eq(externalEvents.calendarID, row.calendarID), or(eq(externalEvents.externalEventID, row.externalEventID!), eq(externalEvents.externalSeriesID, row.externalEventID!)))).orderBy(externalEvents.eventID, externalEvents.id).for("update");
      }
      if (row.payload.reminderEdit || row.payload.rsvp) {
        await tx.select({ role: calendarMembers.role }).from(calendarMembers).where(and(eq(calendarMembers.calendarID, row.calendarID), eq(calendarMembers.userID, userID))).for("share");
        await tx.select({ id: externalEvents.id }).from(externalEvents).where(and(eq(externalEvents.eventID, row.eventID), eq(externalEvents.calendarID, row.calendarID), eq(externalEvents.provider, row.provider))).for("update");
      }
      // Stabilize all target attempts before deciding which chain is superseded.
      await tx
        .select({ id: eventOutbox.id })
        .from(eventOutbox)
        .where(
          and(
            eq(eventOutbox.eventID, row.eventID),
            eq(eventOutbox.externalCalendarLinkID, row.externalCalendarLinkID),
            or(unresolvedEventOutbox(), eq(eventOutbox.id, row.id)),
          ),
        )
        .orderBy(eventOutbox.id)
        .for("update");
      const current = await resolutionContext(tx, userID, row.eventID, row.id);
      // A retry/pull can change uncertainty without changing the local revision
      // or latest operation ID. In particular, never replace a newly ambiguous
      // create with another identity based on an earlier absence observation.
      if (
        JSON.stringify(current.pending) !==
        JSON.stringify(proof.context.pending)
      )
        throw new EventDeliveryResolutionError("delivery-state-changed");
      if (
        current.row.action === "create" &&
        !proof.remoteExists &&
        (current.row.uncertain ||
          current.row.status === "unconfirmed" ||
          current.row.remoteSnapshot)
      )
        throw new EventDeliveryResolutionError(
          "delivery-resolution-unavailable",
        );
      if (
        !!current.row.payload.rsvp !== !!proof.rsvp ||
        proof.rsvp?.baselineVersion !== request.expectedRsvpBaselineVersion ||
        !!current.row.payload.reminderEdit !== !!proof.reminder ||
        proof.reminder?.stateVersion !== request.expectedReminderStateVersion ||
        current.masterRevision !== request.expectedMasterRevision ||
        current.masterRevision !== proof.context.masterRevision ||
        !!current.row.payload.googleOccurrence !== !!proof.googleOccurrence ||
        !!current.row.payload.caldavSeries !== !!proof.caldavSeries ||
        !sameCaldavScopeContext(current.caldavContext, proof.context.caldavContext) ||
        current.localRevision !== request.expectedLocalRevision ||
        current.latest.id !== request.expectedLatestOperationId ||
        current.localRevision !== proof.context.localRevision ||
        current.latest.id !== proof.context.latest.id ||
        current.deleted !== proof.context.deleted ||
        proof.action !==
          (current.deleted
            ? "delete"
            : proof.remoteExists
              ? "update"
              : "create") ||
        proof.remoteExists !== request.expectedRemoteExists ||
        (proof.remoteExists ? (proof.ref?.etag ?? null) : null) !==
          request.expectedRemoteEtag
      )
        throw new EventDeliveryResolutionError("delivery-state-changed");
      const mappingKey = (mapping: typeof current.mapping) =>
        mapping
          ? JSON.stringify([mapping.id, mapping.externalEventID, mapping.etag, ...(proof.reminder || proof.rsvp ? [providerStateVersion(mapping)] : [])])
          : null;
      if (mappingKey(current.mapping) !== mappingKey(proof.context.mapping))
        throw new EventDeliveryResolutionError("delivery-state-changed");
      if (proof.rsvp) {
        const { intent, baselineVersion } = proof.rsvp;
        if (!current.mapping || !proof.ref || intent.mappingID !== current.mapping.id ||
            intent.baseline.id !== proof.ref.externalEventId || intent.baseline.etag !== proof.ref.etag ||
            !intent.nativeTime || !isDeepStrictEqual(ProviderRsvpEditSchema.parse(intent.request), ProviderRsvpEditSchema.parse(current.row.payload.rsvp!.request)) ||
            providerRsvpBaselineVersion(current.mapping.id, intent.baseline) !== baselineVersion ||
            !isDeepStrictEqual(providerRsvpDesiredState(intent.baselineState, row.externalCalendarID, intent.request.response), intent.desiredState))
          throw new EventDeliveryResolutionError("delivery-state-changed");
      }
      if (proof.ref) {
        if (
          current.mapping &&
          current.mapping.externalEventID !== proof.ref.externalEventId
        )
          throw new EventDeliveryResolutionError("delivery-state-changed");
        const [deletion] = await tx
          .select()
          .from(externalEventTombstones)
          .where(
            and(
              eq(
                externalEventTombstones.externalCalendarLinkID,
                row.externalCalendarLinkID,
              ),
              eq(
                externalEventTombstones.externalEventID,
                proof.ref.externalEventId,
              ),
            ),
          );
        if (
          (deletion?.id ?? null) !== (proof.deletion?.id ?? null) ||
          (deletion?.observedAt.getTime() ?? null) !==
            (proof.deletion?.observedAt.getTime() ?? null)
        )
          throw new EventDeliveryResolutionError("delivery-state-changed");
        if (proof.remoteExists) {
          const [occupied] = await tx
            .select()
            .from(externalEvents)
            .where(
              and(
                eq(externalEvents.calendarID, row.calendarID),
                eq(externalEvents.provider, row.provider),
                eq(externalEvents.externalEventID, proof.ref.externalEventId),
              ),
            );
          if (
            (occupied && occupied.eventID !== row.eventID) ||
            (current.mapping &&
              current.mapping.externalEventID !== proof.ref.externalEventId)
          )
            throw new EventDeliveryResolutionError("delivery-state-changed");
          if (deletion)
            await tx
              .delete(externalEventTombstones)
              .where(eq(externalEventTombstones.id, deletion.id));
          if (current.mapping && !proof.caldavSeries)
            await tx
              .update(externalEvents)
              .set({
                ...(proof.reminder || proof.rsvp ? { providerState: proof.rsvp?.intent.baselineState ?? proof.reminder!.state, providerStateObservedAt: new Date() } : {}),
                etag: proof.ref.etag,
                icalUid: proof.ref.icalUid ?? current.mapping.icalUid,
              })
              .where(eq(externalEvents.id, current.mapping.id));
          else if (!current.mapping && !current.deleted)
            await tx.insert(externalEvents).values({
              provider: row.provider,
              eventID: row.eventID,
              calendarID: row.calendarID,
              externalCalendarID: row.externalCalendarID,
              externalEventID: proof.ref.externalEventId,
              etag: proof.ref.etag,
              icalUid: proof.ref.icalUid,
            });
        } else if (proof.action === "create" && current.mapping) {
          await tx
            .delete(externalEvents)
            .where(eq(externalEvents.id, current.mapping.id));
        }
      }
      if (proof.caldavSeries) {
        const family = current.caldavContext;
        if (!family || !proof.ref || !proof.remoteExists || proof.action !== "update" ||
            !sameCaldavScopeContext(proof.caldavSeries.context, { ...family, mappings: family.mappings.map(item => ({ ...item, etag: proof.ref!.etag })) }) ||
            !sameCaldavScopeContext(proof.caldavSeries.write.baseline.ref, proof.ref))
          throw new EventDeliveryResolutionError("delivery-state-changed");
        await tx.update(externalEvents).set({ etag: proof.ref.etag }).where(inArray(externalEvents.id, family.mappings.map(item => item.id)));
      }
      const replaced = [
        ...new Set(
          current.pending.flatMap((item) => [
            item.id,
            ...(item.payload.resolution?.replacedOperationIDs ?? []),
          ]),
        ),
      ];
      await tx
        .update(eventOutbox)
        .set({
          status: "cancelled",
          errorCode: "superseded-by-resolution",
          leaseToken: null,
          leaseUntil: null,
          updatedAt: new Date(),
        })
        .where(inArray(eventOutbox.id, replaced));
      const id = randomUUID();
      await tx.insert(eventOutbox).values({
        id,
        createdAt: eventOutboxCreatedAt(
          row.eventID,
          row.externalCalendarLinkID,
        ),
        actorID: userID,
        mutationID: request.mutationId,
        position: 0,
        eventID: row.eventID,
        revision: current.localRevision ?? current.latest.revision,
        predecessorID: null,
        calendarID: row.calendarID,
        externalCalendarLinkID: row.externalCalendarLinkID,
        provider: row.provider,
        userID,
        accountID: row.accountID,
        externalCalendarID: row.externalCalendarID,
        externalEventID:
          proof.action === "create" ? null : proof.ref?.externalEventId,
        expectedEtag: proof.action === "create" ? null : proof.ref?.etag,
        icalUid: proof.action === "create" ? null : proof.ref?.icalUid,
        action: proof.action,
        uncertain: proof.action !== "create",
        payload: {
          event: current.local,
          patch: proof.patch,
          ...(proof.rsvp ? { rsvp: { ...proof.rsvp.intent, request: { ...proof.rsvp.intent.request, operationID: request.mutationId, expectedRevision: current.localRevision!, expectedStateVersion: providerStateVersion({ id: current.mapping!.id, etag: proof.ref!.etag ?? null, providerState: proof.rsvp.intent.baselineState })! } } } : {}),
          ...(proof.reminder ? { reminderEdit: { ...proof.reminder.intent, operationID: request.mutationId, expectedRevision: current.localRevision!, expectedStateVersion: proof.reminder.stateVersion } } : {}),
          ...(proof.caldavSeries ? { caldavSeries: proof.caldavSeries } : {}),
          ...(proof.googleOccurrence
            ? { googleOccurrence: proof.googleOccurrence }
            : {}),
          ...(proof.action === "create"
            ? { createIdentityVersion: 1 as const }
            : {}),
          resolution: {
            operationID: row.id,
            replacedOperationIDs: replaced,
            expectedLocalRevision: request.expectedLocalRevision,
            expectedLatestOperationID: request.expectedLatestOperationId,
            expectedRemoteExists: request.expectedRemoteExists,
            expectedRemoteEtag: request.expectedRemoteEtag,
            expectedMasterRevision: request.expectedMasterRevision,
            expectedReminderStateVersion: request.expectedReminderStateVersion,
            expectedRsvpBaselineVersion: request.expectedRsvpBaselineVersion,
          },
        },
      });
      return id;
    });
  } catch (error) {
    if (
      error instanceof EventDeliveryResolutionError ||
      error instanceof NotFoundError ||
      error instanceof EventDeliveryRetryError
    )
      throw error;
    // Drizzle errors can contain the full bound JSON event. Never log them.
    throw new Error(
      "Delivery resolution persistence failed; no resolution was committed.",
    );
  }
}
