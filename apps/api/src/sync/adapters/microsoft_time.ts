import { z } from "zod";
import { instantToCivil, unambiguousCivilToInstant } from "@musubi/calendar";
import { CivilDateTimeSchema, EventTimeModelSchema, EventTimeZoneSchema, EventWriteError, OccurrenceStartSchema, type OccurrenceStart, type Event } from "@musubi/types";

const DAY = 86_400_000;
function refuse(): never { throw new EventWriteError("event-write", "unsupported", "Outlook requires an explicit, exact, unambiguous master time. No changes were saved."); }
type Time = Pick<Event, "start" | "end" | "isAllDay" | "timeModel">;

/** Candidate serializer only; this does not enable Graph recurring creation. */
export function graphTimeForEvent(event: Time) {
  try {
    const model = EventTimeModelSchema.parse(event.timeModel);
    if (!Number.isFinite(event.start.getTime()) || !Number.isFinite(event.end.getTime()) || event.end < event.start ||
        (model.kind !== "zoned" && model.kind !== "all-day") || event.isAllDay !== (model.kind === "all-day")) refuse();
    if (model.kind === "all-day") {
      if (![event.start, event.end].every(value => /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(value.toISOString()))) refuse();
      const end = new Date(event.end.getTime() + DAY).toISOString();
      if (!/^\d{4}-/.test(end)) refuse();
      return { isAllDay: true, start: { dateTime: event.start.toISOString().slice(0, -1), timeZone: "UTC" }, end: { dateTime: end.slice(0, -1), timeZone: "UTC" } };
    }
    for (const [instant, civil] of [[event.start, model.startLocal], [event.end, model.endLocal]] as const)
      if (unambiguousCivilToInstant(civil, model.timeZone).getTime() !== instant.getTime()) refuse();
    return { isAllDay: false, start: { dateTime: model.startLocal, timeZone: model.timeZone }, end: { dateTime: model.endLocal, timeZone: model.timeZone } };
  } catch { return refuse(); }
}

// A read must explicitly request the UTC projection. Never treat an arbitrary
// offset-free Graph timestamp, or a Windows/custom zone, as an IANA instant.
const utcEndpoint = z.object({ dateTime: z.string(), timeZone: z.literal("UTC") }).strict();
const masterTime = z.object({
  type: z.literal("seriesMaster"), isAllDay: z.boolean(), isCancelled: z.literal(false),
  seriesMasterId: z.null().optional(), originalStart: z.null().optional(),
  start: utcEndpoint, end: utcEndpoint,
  originalStartTimeZone: z.string().optional(), originalEndTimeZone: z.string().optional(),
  recurrence: z.object({ range: z.object({ recurrenceTimeZone: z.string().optional() }) }),
});
function utcDate(value: string): Date {
  // Graph uses up to seven fractional digits. Accept extra zero precision only;
  // truncating nonzero digits could collapse distinct provider time values.
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?$/.exec(value);
  if (!match || /[1-9]/.test((match[2] ?? "").slice(3))) refuse();
  const civil = CivilDateTimeSchema.parse(`${match[1]}.${(match[2] ?? "").padEnd(3, "0").slice(0, 3)}`);
  return new Date(civil + "Z");
}

export function graphOriginalStartFromUtc(value: unknown, isAllDay: boolean): OccurrenceStart {
  if (typeof value !== "string" || !value.endsWith("Z")) refuse();
  const instant = utcDate(value.slice(0, -1));
  if (isAllDay && !instant.toISOString().endsWith("T00:00:00.000Z")) refuse();
  return OccurrenceStartSchema.parse(isAllDay ? { kind: "date", value: instant.toISOString().slice(0, 10) } : { kind: "instant", value: instant.toISOString() });
}

const instanceTime = z.object({
  type: z.enum(["occurrence", "exception"]), seriesMasterId: z.string(), originalStart: z.string(),
  isAllDay: z.boolean(), isCancelled: z.literal(false), "@removed": z.never().optional(),
  start: utcEndpoint, end: utcEndpoint,
  originalStartTimeZone: z.string().optional(), originalEndTimeZone: z.string().optional(),
});

/** Regular occurrences must equal the proven current recurrence slot. A moved
 * timed exception has exact UTC instants, but historical original*TimeZone
 * labels are not a proof of its current event zone: preserve that uncertainty. */
export function graphInstanceTimeFromUtc(native: unknown, masterID: string, expected: Time & { originalStart: OccurrenceStart }): Time & { originalStart: OccurrenceStart } {
  try {
    const item = instanceTime.parse(native);
    const originalStart = graphOriginalStartFromUtc(item.originalStart, expected.isAllDay);
    if (item.seriesMasterId !== masterID || item.isAllDay !== expected.isAllDay || JSON.stringify(originalStart) !== JSON.stringify(OccurrenceStartSchema.parse(expected.originalStart))) refuse();
    const start = utcDate(item.start.dateTime), exclusiveEnd = utcDate(item.end.dateTime);
    if (exclusiveEnd < start) refuse();
    const end = item.isAllDay ? new Date(exclusiveEnd.getTime() - DAY) : exclusiveEnd;
    if (item.isAllDay && (end < start || ![start, exclusiveEnd].every(value => value.toISOString().endsWith("T00:00:00.000Z")))) refuse();
    if (item.type === "occurrence") {
      graphTimeForEvent(expected);
      if (start.getTime() !== expected.start.getTime() || end.getTime() !== expected.end.getTime()) refuse();
      return { start, end, isAllDay: item.isAllDay, timeModel: EventTimeModelSchema.parse(expected.timeModel), originalStart };
    }
    if (item.isAllDay && [item.originalStartTimeZone, item.originalEndTimeZone].some(value => value !== undefined && value !== "UTC")) refuse();
    return { start, end, isAllDay: item.isAllDay, timeModel: item.isAllDay ? { kind: "all-day" } : { kind: "legacy-unknown" }, originalStart };
  } catch { return refuse(); }
}

/** Comparison-only projection for a saved Prague family. CLDR release 48 maps
 * Central Europe Standard Time / CZ to Europe/Prague; its global default is
 * Budapest, so the Windows label alone must never select an authored zone.
 * https://github.com/unicode-org/cldr/blob/release-48/common/supplemental/windowsZones.xml
 * Generic import and unbound adoption continue to use the strict parser. */
export function graphMasterForSavedZone(native: unknown, saved: Time): unknown {
  const item = z.object({ recurrence: z.object({ range: z.object({ recurrenceTimeZone: z.unknown().optional() }).passthrough() }).passthrough(), originalStartTimeZone: z.unknown().optional(), originalEndTimeZone: z.unknown().optional() }).passthrough().parse(structuredClone(native));
  if (item.recurrence.range.recurrenceTimeZone === "Central Europe Standard Time") {
    const model = EventTimeModelSchema.parse(saved.timeModel);
    if (saved.isAllDay || model.kind !== "zoned" || model.timeZone !== "Europe/Prague" ||
        item.originalStartTimeZone !== "Europe/Prague" || item.originalEndTimeZone !== "Europe/Prague") refuse();
    item.recurrence.range.recurrenceTimeZone = "Europe/Prague";
  }
  return item;
}

/** Strict master-time evidence for future recurring-create recovery. Existing
 * provider-expanded import keeps its separate legacy/coverage contract. */
export function graphMasterTimeFromUtc(native: unknown): Time {
  try {
    const item = masterTime.parse(native);
    const start = utcDate(item.start.dateTime), exclusiveEnd = utcDate(item.end.dateTime);
    if (exclusiveEnd < start) refuse();
    const zone = item.recurrence.range.recurrenceTimeZone;
    if (item.isAllDay) {
      if ([zone, item.originalStartTimeZone, item.originalEndTimeZone].some(value => value !== undefined && value !== "UTC") ||
          exclusiveEnd <= start || ![start, exclusiveEnd].every(value => value.toISOString().endsWith("T00:00:00.000Z"))) refuse();
      const result: Time = { start, end: new Date(exclusiveEnd.getTime() - DAY), isAllDay: true, timeModel: { kind: "all-day" } };
      graphTimeForEvent(result);
      return result;
    }
    const timeZone = EventTimeZoneSchema.parse(zone);
    if ([item.originalStartTimeZone, item.originalEndTimeZone].some(value => value !== undefined && value !== timeZone)) refuse();
    const result: Time = { start, end: exclusiveEnd, isAllDay: false, timeModel: { kind: "zoned", timeZone, startLocal: instantToCivil(start, timeZone), endLocal: instantToCivil(exclusiveEnd, timeZone) } };
    graphTimeForEvent(result);
    return result;
  } catch { return refuse(); }
}
