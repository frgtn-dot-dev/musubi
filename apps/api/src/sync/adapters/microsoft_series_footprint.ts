import { expandRecurringEvents, resolveEventTimeEdit, unambiguousCivilToInstant } from "@musubi/calendar";
import { EventTimeModelSchema, EventWriteError, OccurrenceStartSchema, type Event, type EventTimeModel, type OccurrenceStart, type OccurrenceIdentity } from "@musubi/types";
import { graphRecurrenceForEvent } from "./microsoft_recurrence";
import { graphTimeForEvent } from "./microsoft_time";

const DAY = 86_400_000;
export const GRAPH_SERIES_MAX_OCCURRENCES = 366;
export const GRAPH_SERIES_MAX_DAYS = 730;
export type GraphSeriesOccurrence = {
  originalStart: OccurrenceStart;
  start: Date;
  end: Date;
  isAllDay: boolean;
  timeModel: Extract<EventTimeModel, { kind: "zoned" | "all-day" }>;
};
function refuse(): never {
  throw new EventWriteError("recurrence", "unsupported", "Outlook series creation currently requires at most 366 unambiguous occurrences with COUNT, wholly within 730 days. Timed occurrences must stay within one civil day with a fixed duration. No changes were saved.");
}

/** Complete, finite original-slot set for the future Graph family importer.
 * No missing occurrence can be called cancelled from a bounded calendarView.
 * The native reader must instead verify this whole set and explicit native
 * cancellation evidence. This helper alone never classifies native absence. */
export function graphSeriesFootprint(event: Event): GraphSeriesOccurrence[] {
  try {
    const candidate = graphRecurrenceForEvent(event);
    if (event.isCanceled || candidate.range.type !== "numbered" || !candidate.range.numberOfOccurrences || candidate.range.numberOfOccurrences > GRAPH_SERIES_MAX_OCCURRENCES) refuse();
    const masterModel = EventTimeModelSchema.parse(event.timeModel);
    const rawSlots = new Map<number, number>();
    if (masterModel.kind === "zoned") {
      // COUNT expansion intentionally replenishes skipped gap occurrences.
      // First enumerate the COUNT civil slots in UTC, where no DST gap can
      // disappear, then prove both original endpoints in the actual zone.
      const civil = { ...event, ...resolveEventTimeEdit({ kind: "floating", startLocal: masterModel.startLocal, endLocal: masterModel.endLocal }) };
      const raw = expandRecurringEvents([civil], civil.start, new Date(civil.start.getTime() + GRAPH_SERIES_MAX_DAYS * DAY), { consumerTimeZone: "UTC" });
      if (raw.length !== candidate.range.numberOfOccurrences) refuse();
      for (const value of raw) {
        const model = EventTimeModelSchema.parse(value.timeModel);
        if (model.kind !== "floating") refuse();
        const start = unambiguousCivilToInstant(model.startLocal, masterModel.timeZone).getTime();
        const end = unambiguousCivilToInstant(model.endLocal, masterModel.timeZone).getTime();
        if (end - start !== event.end.getTime() - event.start.getTime() || rawSlots.has(start)) refuse();
        rawSlots.set(start, end);
      }
    }
    const boundary = new Date(event.start.getTime() + GRAPH_SERIES_MAX_DAYS * DAY);
    const values = expandRecurringEvents<Event & { occurrenceIdentity?: OccurrenceIdentity }>([event], event.start, boundary, { consumerTimeZone: "UTC" });
    if (values.length !== candidate.range.numberOfOccurrences) refuse();
    const seen = new Set<string>();
    return values.map(value => {
      graphTimeForEvent(value);
      if (value.occurrenceIdentity?.seriesId !== event.id) refuse();
      const originalStart = OccurrenceStartSchema.parse(value.occurrenceIdentity.originalStart);
      const model = EventTimeModelSchema.parse(value.timeModel);
      if (model.kind !== "zoned" && model.kind !== "all-day") refuse();
      const key = JSON.stringify(originalStart);
      if (seen.has(key) || value.start < event.start || value.end.getTime() + (value.isAllDay ? DAY : 0) > boundary.getTime() ||
          (model.kind === "zoned" && rawSlots.get(value.start.getTime()) !== value.end.getTime()) ||
          (model.kind === "zoned" && (model.startLocal.slice(0, 10) !== model.endLocal.slice(0, 10) || value.end <= value.start || value.end.getTime() - value.start.getTime() !== event.end.getTime() - event.start.getTime()))) refuse();
      seen.add(key);
      return { originalStart, start: new Date(value.start.getTime()), end: new Date(value.end.getTime()), isAllDay: value.isAllDay, timeModel: model };
    });
  } catch { return refuse(); }
}
