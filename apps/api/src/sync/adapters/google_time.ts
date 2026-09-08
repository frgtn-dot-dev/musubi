import { civilToInstant, instantToCivil } from "@musubi/calendar";
import { EventTimeModelSchema, EventTimeZoneSchema, OccurrenceStartSchema, type EventTimeModel, type OccurrenceStart } from "@musubi/types";
import type { NormalizedEvent } from "../adapter";

type GoogleTime = { date?: string; dateTime?: string; timeZone?: string };
function instant(value: GoogleTime, fallbackZone?: string): Date {
  if (value.date) {
    const date = OccurrenceStartSchema.parse({ kind: "date", value: value.date });
    return new Date(`${date.value}T00:00:00.000Z`);
  }
  if (!value.dateTime) throw new Error("Google event has no time value.");
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value.dateTime)) {
    const date = new Date(value.dateTime);
    if (!Number.isFinite(date.getTime())) throw new Error("Invalid Google event instant.");
    return date;
  }
  const zone = EventTimeZoneSchema.parse(value.timeZone ?? fallbackZone);
  return civilToInstant(value.dateTime, zone, "explicit")!;
}
function original(value: GoogleTime, zone?: string): OccurrenceStart {
  return OccurrenceStartSchema.parse(value.date ? { kind: "date", value: value.date } : { kind: "instant", value: instant(value, zone).toISOString() });
}

/** Google cancellation-only exceptions carry identity, not a complete event. */
export function normalizeGoogleTime(item: any, base: NormalizedEvent, master?: any): NormalizedEvent {
  const externalSeriesID = typeof item.recurringEventId === "string" ? item.recurringEventId : null;
  if (externalSeriesID && (!master || master.id !== externalSeriesID || !master.recurrence?.length || master.recurringEventId))
    throw new Error("Google occurrence requires a complete series master.");
  const zone = item.start?.timeZone ?? master?.start?.timeZone;
  const originalStart = externalSeriesID ? original(item.originalStartTime ?? {}, master.start?.timeZone) : null;
  if (item.status === "cancelled" && !externalSeriesID) return base;
  let start: Date;
  let end: Date;
  let isAllDay: boolean;
  const cancelled = item.status === "cancelled";
  if (cancelled) {
    isAllDay = originalStart!.kind === "date";
    start = new Date(originalStart!.value + (isAllDay ? "T00:00:00.000Z" : ""));
    const masterStart = instant(master.start);
    const masterEnd = instant(master.end, master.start?.timeZone);
    end = new Date(start.getTime() + masterEnd.getTime() - masterStart.getTime() - (isAllDay ? 86400000 : 0));
  } else {
    isAllDay = !!item.start?.date;
    if (isAllDay !== !!item.end?.date) throw new Error("Google event start/end time kinds disagree.");
    start = instant(item.start ?? {}, zone);
    end = instant(item.end ?? {}, zone);
    if (isAllDay) end = new Date(end.getTime() - 86400000);
  }
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start)
    throw new Error("Invalid Google event time range.");
  // Offset-only one-offs retain an unresolved zone; never pretend the viewer's
  // zone is the event's. Recurring definitions must carry Google's required TZID.
  let timeModel: EventTimeModel = { kind: "legacy-unknown" };
  if (isAllDay) timeModel = { kind: "all-day" };
  else if (zone) timeModel = { kind: "zoned", timeZone: EventTimeZoneSchema.parse(zone), startLocal: instantToCivil(start, zone), endLocal: instantToCivil(end, zone) };
  else if (externalSeriesID || item.recurrence?.length) throw new Error("Google recurring event requires an explicit time zone.");
  return {
    ...base, start, end, isAllDay,
    status: "active", isCanceled: cancelled,
    title: cancelled ? master.summary ?? "(untitled)" : base.title,
    recurrence: externalSeriesID ? null : item.recurrence?.join("\n") ?? null,
    timeModel: EventTimeModelSchema.parse(timeModel), externalSeriesID, originalStart,
  };
}
