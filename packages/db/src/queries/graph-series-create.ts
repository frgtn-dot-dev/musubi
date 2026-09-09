import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { config } from "@musubi/config";
import { expandRecurringEvents } from "@musubi/calendar";
import { EventSchema, EventWriteError, can, type Event } from "@musubi/types";
import { db } from "..";
import { account, calendarEvents, calendarMembers, events, externalCalendars, externalEvents, eventOutbox } from "../schema";
import type { DbTransaction } from "./calendars";
import { lockCalendarLifecycle, lockUserLifecycle } from "./calendar-lifecycle";
import { appendEventOutbox } from "./event-outbox";
import { createEventInTransaction } from "./events";
import { hasProviderSyncScopes } from "./oauth";

export type GraphSeriesCreateJournal = { version: 1; nativeEvent: Event };
function refuse(): never { throw new EventWriteError("event-write", "unsupported", "Outlook series creation requires unchanged personal intent and a writable connected destination."); }
const normalize = (input: unknown): Event => {
  const event = EventSchema.parse(input);
  const uuid = (value: string) => z.string().uuid().parse(value).toLowerCase();
  return { ...event, id: uuid(event.id), calendars: event.calendars.map(uuid), originCalendarID: event.originCalendarID ? uuid(event.originCalendarID) : null,
    seriesID: event.seriesID ?? null, originalStart: event.originalStart ?? null, description: event.description ?? null, location: event.location ?? null, recurrence: event.recurrence ?? null, url: event.url ?? null };
};
const same = (a: unknown, b: unknown) => isDeepStrictEqual(normalize(a), normalize(b));

/** Private canonical admission only. API preflight must additionally validate
 * the exact Graph recurrence serializer and civil footprint before queuing. */
export function graphSeriesCreateProjection(input: unknown, actorID: string): Event {
  const event = normalize(input);
  const count = /(?:^|;)COUNT=([1-9]\d*)(?:;|$)/.exec(event.recurrence?.replace(/^RRULE:/, "") ?? "");
  if (event.creatorID !== actorID || event.organizer !== actorID || event.revision !== 1 || event.calendars.length !== 1 ||
      event.originCalendarID !== event.calendars[0] || event.isCanceled || event.hasAttendees || event.seriesID || event.originalStart || event.url ||
      !["zoned", "all-day"].includes(event.timeModel?.kind ?? "") || !count || Number(count[1]) > 366) refuse();
  const end = new Date(event.start.getTime() + 730 * 86_400_000);
  const slots = expandRecurringEvents([event], event.start, end, { consumerTimeZone: "UTC" });
  if (slots.length !== Number(count[1]) || slots.some(slot => slot.end.getTime() + (slot.isAllDay ? 86_400_000 : 0) > end.getTime())) refuse();
  // Native personal creation must not turn the local actor ID into an attendee
  // or an organizer supplied to Graph. Keep this explicit projection frozen.
  return { ...event, organizer: "" };
}

async function destination(tx: DbTransaction, actorID: string, calendarID: string) {
  const [grant] = await tx.select().from(calendarMembers).where(and(eq(calendarMembers.calendarID, calendarID), eq(calendarMembers.userID, actorID))).for("share");
  const [link] = await tx.select().from(externalCalendars).where(eq(externalCalendars.calendarID, calendarID)).for("share");
  if (!grant || !can(grant.role, "editEvents") || !link || link.provider !== "microsoft" || link.userID !== actorID || link.disabled || !link.supportsEvents) refuse();
  const [connection] = await tx.select({ id: account.id, scope: account.scope, status: account.syncStatus, refresh: sql<boolean>`coalesce(length(${account.refreshToken}), 0) > 0` }).from(account)
    .where(and(eq(account.userId, actorID), eq(account.providerId, "microsoft"), eq(account.accountId, link.accountID))).for("share");
  if (!connection || connection.status !== "active" || !connection.refresh || !hasProviderSyncScopes("microsoft", connection.scope ?? "")) refuse();
  return link;
}

/** No provider IO. Exact mutation replay retains the original native transaction
 * UUID; changed payload cannot reuse it. This is not a public create endpoint. */
export async function queueGraphSeriesCreate(actorID: string, operationID: string, input: unknown) {
  if (!config.api.eventTimeEditsEnabled) refuse();
  operationID = z.string().uuid().parse(operationID).toLowerCase();
  const event = normalize(input);
  const nativeEvent = graphSeriesCreateProjection(event, actorID);
  const calendarID = event.calendars[0]!;
  return db.transaction(async tx => {
    await lockUserLifecycle(tx, [actorID], "shared");
    await lockCalendarLifecycle(tx, [calendarID], "exclusive");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["musubi:event-mutation", actorID, operationID])}, 0))`);
    const link = await destination(tx, actorID, calendarID);
    const existing = await tx.select().from(eventOutbox).where(and(eq(eventOutbox.actorID, actorID), eq(eventOutbox.mutationID, operationID))).orderBy(eventOutbox.position);
    if (existing.length) {
      const row = existing[0]!;
      if (existing.length !== 1 || row.position !== 0 || row.action !== "create" || row.provider !== "microsoft" || row.userID !== actorID || row.eventID !== event.id || row.revision !== 1 ||
          row.calendarID !== calendarID || row.externalCalendarLinkID !== link.id || row.accountID !== link.accountID || row.externalCalendarID !== link.externalCalendarID ||
          row.payload.graphSeriesCreate?.version !== 1 || !same(row.payload.event, event) || !same(row.payload.graphSeriesCreate.nativeEvent, nativeEvent)) refuse();
      return { event: EventSchema.parse(row.payload.event), operationID: row.id };
    }
    // No partially adopted identity or previous journal may be repurposed.
    const old = await tx.select({ id: eventOutbox.id }).from(eventOutbox).where(eq(eventOutbox.eventID, event.id)).limit(1);
    const mappings = await tx.select({ id: externalEvents.id }).from(externalEvents).where(eq(externalEvents.eventID, event.id)).limit(1);
    const children = await tx.select({ id: events.id }).from(events).where(eq(events.seriesID, event.id)).limit(1);
    if (old.length || mappings.length || children.length) refuse();
    const saved = EventSchema.parse({ ...await createEventInTransaction(tx, event, [calendarID]), calendars: [calendarID] });
    if (!same(saved, event)) refuse();
    const id = randomUUID();
    await appendEventOutbox(tx, saved, [{ id, actorID, mutationID: operationID, position: 0, eventID: event.id, calendarID,
      externalCalendarLinkID: link.id, provider: "microsoft", userID: actorID, accountID: link.accountID, externalCalendarID: link.externalCalendarID,
      action: "create", externalEventID: null, expectedEtag: null, icalUid: null,
      payload: { event: saved, createIdentityVersion: 1, graphSeriesCreate: { version: 1, nativeEvent } },
    }]);
    return { event: saved, operationID: id };
  }).catch(() => { throw new Error("Outlook recurring intent could not be queued. No changes were saved."); });
}

/** Caller holds calendar lifecycle admission. An uncertain new POST has no
 * native parent address yet, so ordinary import must wait for full-family ACK.
 * A disconnected historical link cannot block a replacement connection. */
export async function assertNoPendingGraphSeriesCreate(tx: Pick<DbTransaction, "select">, calendarID: string) {
  const [pending] = await tx.select({ id: eventOutbox.id }).from(eventOutbox)
    .innerJoin(externalCalendars, eq(externalCalendars.id, eventOutbox.externalCalendarLinkID))
    .where(and(eq(externalCalendars.calendarID, calendarID), eq(externalCalendars.provider, "microsoft"), eq(eventOutbox.provider, "microsoft"),
      eq(eventOutbox.calendarID, calendarID), eq(eventOutbox.userID, externalCalendars.userID), eq(eventOutbox.accountID, externalCalendars.accountID), eq(eventOutbox.externalCalendarID, externalCalendars.externalCalendarID),
      sql`${eventOutbox.payload}->'graphSeriesCreate' is not null and ${eventOutbox.status} not in ('completed', 'not-needed')`)).limit(1);
  if (pending) throw new Error("Outlook series creation awaits complete family reconciliation.");
}

/** Short before-POST lease/authority check. Native delivery and atomic full-family
 * ACK are separate; generic per-event completion must never accept this row. */
export async function readGraphSeriesCreateOutboxInTransaction(tx: DbTransaction, id: string, token: string) {
  if (!config.api.eventTimeEditsEnabled) return null;
    const [initial] = await tx.select().from(eventOutbox).where(eq(eventOutbox.id, id));
    if (!initial?.payload.graphSeriesCreate) return null;
    await lockUserLifecycle(tx, [initial.userID], "shared");
    await lockCalendarLifecycle(tx, [initial.calendarID], "exclusive");
    const [event] = await tx.select().from(events).where(eq(events.id, initial.eventID)).for("update");
    const links = await tx.select().from(calendarEvents).where(eq(calendarEvents.eventID, initial.eventID)).for("share");
    const children = await tx.select({ id: events.id }).from(events).where(eq(events.seriesID, initial.eventID)).limit(1);
    const mappings = await tx.select({ id: externalEvents.id }).from(externalEvents).where(eq(externalEvents.eventID, initial.eventID)).limit(1);
    if (!event || event.deletedAt || children.length || mappings.length || links.length !== 1 || links[0]!.calendarID !== initial.calendarID) return null;
    const link = await destination(tx, initial.userID, initial.calendarID);
    const history = await tx.select().from(eventOutbox).where(eq(eventOutbox.eventID, initial.eventID)).orderBy(eventOutbox.id).for("update");
    if (history.length !== 1) return null;
    const row = history[0]!;
    if (row.calendarID !== link.calendarID || row.userID !== link.userID || !row.uncertain || row.id !== id || row.status !== "attempting" || row.leaseToken !== token || row.actorID !== row.userID || row.provider !== "microsoft" || row.action !== "create" || row.position !== 0 || row.revision !== 1 || row.predecessorID || row.externalEventID || row.expectedEtag || row.icalUid || row.resultRef || row.remoteSnapshot ||
        row.externalCalendarLinkID !== link.id || row.accountID !== link.accountID || row.externalCalendarID !== link.externalCalendarID || row.payload.createIdentityVersion !== 1 || row.payload.graphSeriesCreate?.version !== 1 ||
        Object.keys(row.payload).some(key => !["event", "createIdentityVersion", "graphSeriesCreate"].includes(key)) || !same({ ...event, calendars: [link.calendarID] }, row.payload.event) ||
        !same(graphSeriesCreateProjection(row.payload.event, row.userID), row.payload.graphSeriesCreate.nativeEvent)) return null;
    const [leased] = await tx.select({ id: eventOutbox.id }).from(eventOutbox).where(and(eq(eventOutbox.id, id), eq(eventOutbox.leaseToken, token), sql`${eventOutbox.leaseUntil} > clock_timestamp()`));
    return leased ? { row, event, link } : null;

}

export async function confirmGraphSeriesCreateOutbox(id: string, token: string): Promise<boolean> {
  return db.transaction(async tx => !!await readGraphSeriesCreateOutboxInTransaction(tx, id, token)).catch(() => false);
}
