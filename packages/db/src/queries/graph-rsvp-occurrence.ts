import { EventWriteError, GraphRsvpOccurrenceSchema, type GraphRsvpOccurrence } from "@musubi/types";
import type { events, externalEvents } from "../schema";

/** Exact imported attendee slot. A native series ID without originalStart is
 * incomplete evidence, never permission to send a response to its master. */
export function readGraphRsvpOccurrence(
  event: Pick<typeof events.$inferSelect, "id" | "creatorID" | "originCalendarID" | "seriesID" | "originalStart" | "recurrence" | "isCanceled" | "deletedAt">,
  mapping: typeof externalEvents.$inferSelect,
  actorID: string,
): GraphRsvpOccurrence | undefined {
  const fail = (): never => { throw new EventWriteError("event-write", "unsupported"); };
  if (event.seriesID || event.originalStart || event.recurrence || event.isCanceled || event.deletedAt) return fail();
  if (!mapping.externalSeriesID && !mapping.originalStart) return undefined;
  if (mapping.provider !== "microsoft" || mapping.eventID !== event.id || event.creatorID !== actorID ||
      event.originCalendarID !== mapping.calendarID || mapping.externalSeriesID === mapping.externalEventID ||
      !mapping.icalUid || !["occurrence", "exception"].includes(mapping.providerState?.eventType ?? "")) return fail();
  const occurrence = GraphRsvpOccurrenceSchema.safeParse({ externalSeriesID: mapping.externalSeriesID, originalStart: mapping.originalStart });
  return occurrence.success ? occurrence.data : fail();
}
