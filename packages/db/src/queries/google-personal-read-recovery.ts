import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { EventSchema, type Event } from "@musubi/types";
import { eventOutbox, externalEvents, type events } from "../schema";
import type { DbTransaction } from "./calendars";
import type { EventOutboxRow } from "./event-outbox";
import type { ExternalCalendarAccessContext } from "./external-access";
import { matchesReminderEventProjection, matchesRsvpEventProjection } from "./event-outbox-projection";

function personal(row: EventOutboxRow) {
  const payload = row.payload;
  return row.provider === "google" && row.action === "update" && row.actorID === row.userID &&
    [payload.reminderEdit, payload.reminderInstance, payload.rsvp].filter(Boolean).length === 1 &&
    !payload.googleOccurrence && !payload.caldavSeries && !payload.caldavSplit && !payload.caldavSeriesDeletion && !payload.graphSeriesCreate;
}
function intentHash(row: EventOutboxRow) {
  return createHash("sha256").update(JSON.stringify([row.payload, row.action, row.expectedEtag, row.externalEventID, row.revision, row.mutationID])).digest("hex");
}
function lineage(row: EventOutboxRow, revision: number) {
  const proof = row.personalReadRecovery;
  return personal(row) && !!proof && proof.acceptedRevision === row.revision && proof.intentHash === intentHash(row) &&
    (proof.restoredRevision ?? proof.redactedRevision) === revision;
}
async function solePending(tx: DbTransaction, eventID: string, calendarID: string) {
  const rows = await tx.select().from(eventOutbox).where(and(eq(eventOutbox.eventID, eventID), eq(eventOutbox.calendarID, calendarID), eq(eventOutbox.provider, "google"), sql`${eventOutbox.status} not in ('completed', 'not-needed', 'cancelled')`)).for("update");
  return rows.length === 1 && personal(rows[0]!) ? rows[0] : undefined;
}

/** Preserve a verifiable path to the immutable personal intent, not a write grant. */
export async function markGooglePersonalReadRedaction(tx: DbTransaction, event: typeof events.$inferSelect, sourceID: string) {
  const row = await solePending(tx, event.id, event.originCalendarID!);
  if (!row || row.externalCalendarLinkID !== sourceID || row.userID !== event.creatorID) return;
  const [mapping] = await tx.select({ id: externalEvents.id }).from(externalEvents).where(and(eq(externalEvents.eventID, event.id), eq(externalEvents.calendarID, event.originCalendarID!), eq(externalEvents.provider, "google"), eq(externalEvents.externalCalendarID, row.externalCalendarID), eq(externalEvents.externalEventID, row.externalEventID ?? "")));
  if (!mapping || (row.personalReadRecovery && row.personalReadRecovery.mappingID !== mapping.id)) return;
  const saved = EventSchema.parse(row.payload.event);
  const local = EventSchema.parse({ ...event, calendars: saved.calendars });
  const instance = (row.payload.rsvp ?? row.payload.reminderInstance)?.instance;
  const matches = row.payload.reminderEdit ? matchesReminderEventProjection("google", saved, local) : matchesRsvpEventProjection("google", saved, local, instance);
  if (!lineage(row, event.revision) && (row.revision !== event.revision || !matches)) return;
  await tx.update(eventOutbox).set({ personalReadRecovery: { acceptedRevision: row.revision, intentHash: intentHash(row), mappingID: mapping.id, redactedRevision: event.revision + 1, restoredRevision: null } }).where(eq(eventOutbox.id, row.id));
}

/** Only a fresh, source-generation-fenced read may pass a retained personal pull. */
export async function googlePersonalReadRecovery(tx: DbTransaction, event: typeof events.$inferSelect, mapping: typeof externalEvents.$inferSelect, context?: ExternalCalendarAccessContext) {
  if (!context || mapping.provider !== "google" || event.originCalendarID !== mapping.calendarID || event.creatorID !== context.userID || event.deletedAt) return;
  const row = await solePending(tx, event.id, mapping.calendarID);
  if (!row || !lineage(row, event.revision) || row.personalReadRecovery!.mappingID !== mapping.id || row.externalCalendarLinkID !== context.linkID || row.userID !== context.userID || row.accountID !== context.accountID || row.externalCalendarID !== context.externalCalendarID || row.externalEventID !== mapping.externalEventID) return;
  return row;
}

export async function finishGooglePersonalReadRecovery(tx: DbTransaction, row: EventOutboxRow, revision: number) {
  if (row.personalReadRecovery!.restoredRevision === revision) return;
  await tx.update(eventOutbox).set({ personalReadRecovery: { ...row.personalReadRecovery!, restoredRevision: revision } }).where(eq(eventOutbox.id, row.id));
}

/** Explicit resolution still needs full fresh native evidence and unchanged time. */
export function hasGooglePersonalReadRecovery(row: EventOutboxRow, local: Event, mappingID: string) {
  if (local.revision === undefined || row.personalReadRecovery?.mappingID !== mappingID || !lineage(row, local.revision) || row.personalReadRecovery?.restoredRevision !== local.revision) return false;
  const saved = EventSchema.parse(row.payload.event);
  const time = (event: Event) => [event.start, event.end, event.isAllDay, event.timeModel ?? null, event.seriesID ?? null, event.originalStart ?? null, event.recurrence ?? null, event.isCanceled];
  return isDeepStrictEqual(time(saved), time(local));
}
