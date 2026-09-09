import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { EventWriteError, OccurrenceStartSchema, ProviderRsvpInstanceSchema, hasKnownEventTime, type ProviderRsvpInstance } from "@musubi/types";
import { calendarEvents, events, externalEvents, eventOutbox } from "../schema";
import type { DbTransaction } from "./calendars";

/** Caller holds lifecycle and parent-before-child event locks when committing.
 * The parent revision is a local binding fence, not a provider CAS validator. */
export async function readProviderRsvpInstance(
  tx: Pick<DbTransaction, "select">,
  event: typeof events.$inferSelect,
  mapping: typeof externalEvents.$inferSelect,
  actorID: string,
): Promise<ProviderRsvpInstance | undefined> {
  const unsupported = () => new EventWriteError("event-write", "unsupported");
  if (!event.seriesID && !event.originalStart && !mapping.externalSeriesID && !mapping.originalStart) return undefined;
  const original = OccurrenceStartSchema.safeParse(event.originalStart);
  const mappedOriginal = OccurrenceStartSchema.safeParse(mapping.originalStart);
  if (!event.seriesID || event.seriesID === event.id || event.recurrence || event.isCanceled || event.deletedAt ||
      event.creatorID !== actorID || event.originCalendarID !== mapping.calendarID || mapping.eventID !== event.id || mapping.provider !== "google" ||
      !hasKnownEventTime(event) || !["zoned", "all-day"].includes(event.timeModel!.kind) ||
      !mapping.externalSeriesID || mapping.externalSeriesID === mapping.externalEventID ||
      !original.success || original.data.kind === "floating" || !mappedOriginal.success || !isDeepStrictEqual(original.data, mappedOriginal.data) ||
      event.isAllDay !== (original.data.kind === "date")) throw unsupported();
  const parents = await tx.select({ event: events, mapping: externalEvents }).from(events)
    .innerJoin(calendarEvents, and(eq(calendarEvents.eventID, events.id), eq(calendarEvents.calendarID, mapping.calendarID)))
    .innerJoin(externalEvents, and(eq(externalEvents.eventID, events.id), eq(externalEvents.calendarID, mapping.calendarID), eq(externalEvents.provider, "google"), eq(externalEvents.externalCalendarID, mapping.externalCalendarID)))
    .where(and(eq(events.id, event.seriesID), eq(events.originCalendarID, mapping.calendarID), eq(events.creatorID, actorID), isNull(events.deletedAt)));
  const parent = parents[0];
  if (parents.length !== 1 || !parent || !parent.event.recurrence || parent.event.seriesID || parent.event.originalStart || parent.event.isCanceled ||
      !hasKnownEventTime(parent.event) || parent.event.timeModel!.kind !== event.timeModel!.kind ||
      parent.mapping.externalEventID !== mapping.externalSeriesID || parent.mapping.externalSeriesID || parent.mapping.originalStart) throw unsupported();
  // An unresolved parent operation may change/reparent this slot. Do not put a
  // response behind a different event's independent outbox chain.
  const pending = await tx.select({ id: eventOutbox.id }).from(eventOutbox).where(and(
    eq(eventOutbox.eventID, parent.event.id), eq(eventOutbox.calendarID, mapping.calendarID),
    sql`${eventOutbox.status} not in ('completed', 'not-needed', 'cancelled')`,
  )).limit(1);
  const [latest] = await tx.select({ status: eventOutbox.status }).from(eventOutbox).where(and(eq(eventOutbox.eventID, parent.event.id), eq(eventOutbox.calendarID, mapping.calendarID)))
    .orderBy(desc(eventOutbox.revision), desc(eventOutbox.createdAt), desc(eventOutbox.position)).limit(1);
  if (pending.length || latest?.status === "cancelled") throw unsupported();
  return ProviderRsvpInstanceSchema.parse({ seriesID: parent.event.id, parentRevision: parent.event.revision, parentMappingID: parent.mapping.id, externalSeriesID: mapping.externalSeriesID, originalStart: original.data });
}
