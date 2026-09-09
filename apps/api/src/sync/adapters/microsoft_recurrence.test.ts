import assert from "node:assert/strict";
import { EventSchema } from "@musubi/types";
import { resolveEventTimeEdit, expandRecurringEvents } from "@musubi/calendar";
import { graphRecurrenceForEvent, recurrenceFromGraph } from "./microsoft_recurrence";
const event = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000181", revision: 1, creatorID: "owner", organizer: "", title: "Pattern", color: "red", calendars: [], isCanceled: false, recurrence: "RRULE:FREQ=DAILY;COUNT=4", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-02T09:00:00", endLocal: "2026-03-02T10:00:00" }) });
const convert = (recurrence: string) => graphRecurrenceForEvent({ ...event, recurrence });
assert.deepEqual(convert("FREQ=DAILY;INTERVAL=2;COUNT=4"), { pattern: { type: "daily", interval: 2 }, range: { type: "numbered", startDate: "2026-03-02", recurrenceTimeZone: "Europe/Prague", numberOfOccurrences: 4 } });
assert.deepEqual(convert("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE").pattern, { type: "weekly", interval: 2, daysOfWeek: ["monday", "wednesday"], firstDayOfWeek: "monday" });
assert.equal(convert("FREQ=WEEKLY;WKST=SU").pattern.firstDayOfWeek, "sunday");
assert.deepEqual(convert("FREQ=MONTHLY;BYMONTHDAY=2").pattern, { type: "absoluteMonthly", interval: 1, dayOfMonth: 2 });
assert.deepEqual(convert("FREQ=MONTHLY;BYDAY=1MO").pattern, { type: "relativeMonthly", interval: 1, daysOfWeek: ["monday"], index: "first" });
assert.deepEqual(convert("FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1").pattern, convert("FREQ=MONTHLY;BYDAY=1MO").pattern);
assert.deepEqual(convert("FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=2").pattern, { type: "absoluteYearly", interval: 1, dayOfMonth: 2, month: 3 });
assert.deepEqual(convert("FREQ=YEARLY;BYMONTH=3;BYDAY=1MO").pattern, { type: "relativeYearly", interval: 1, daysOfWeek: ["monday"], index: "first", month: 3 });
assert.equal(convert("FREQ=DAILY;UNTIL=20260329T065959Z").range.endDate, "2026-03-28");
assert.equal(convert("FREQ=DAILY;UNTIL=20260329T070000Z").range.endDate, "2026-03-29");
assert.equal(convert("FREQ=DAILY;UNTIL=20260328T230000Z").range.endDate, "2026-03-28");
const allDay = { ...event, ...resolveEventTimeEdit({ kind: "all-day", startDate: "2026-03-02", endDate: "2026-03-02" }), recurrence: "FREQ=DAILY;UNTIL=20260310" };
assert.deepEqual(graphRecurrenceForEvent(allDay).range, { type: "endDate", startDate: "2026-03-02", endDate: "2026-03-10" });
for (const recurrence of ["FREQ=YEARLY;BYMONTHDAY=2;COUNT=4", "FREQ=YEARLY;BYDAY=1MO", "FREQ=HOURLY", "FREQ=DAILY;BYHOUR=9", "FREQ=DAILY;COUNT=2;UNTIL=20260330T070000Z", "FREQ=DAILY;COUNT=0", "FREQ=DAILY;INTERVAL=2147483648", "FREQ=DAILY;COUNT=2;COUNT=3", "FREQ=DAILY\nEXDATE:20260303T080000Z", "FREQ=WEEKLY;BYDAY=TU", "FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=1", "FREQ=MONTHLY;BYDAY=5MO", "FREQ=MONTHLY;BYDAY=1MO;BYSETPOS=1", "FREQ=MONTHLY;BYMONTHDAY=-1", "FREQ=YEARLY;BYMONTH=4", "FREQ=DAILY;UNTIL=20260230T080000Z", "FREQ=DAILY;UNTIL=20260301T080000Z"]) assert.throws(() => convert(recurrence));
assert.throws(() => graphRecurrenceForEvent({ ...event, ...resolveEventTimeEdit({ kind: "floating", startLocal: "2026-03-02T09:00:00", endLocal: "2026-03-02T10:00:00" }) }), /explicit/);
assert.throws(() => graphRecurrenceForEvent({ ...event, ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-31T09:00:00", endLocal: "2026-03-31T10:00:00" }), recurrence: "FREQ=MONTHLY" }), /Month-end/);
console.log("Graph recurrence candidates: six patterns, COUNT/UNTIL, week boundaries and explicit lossless refusals: OK");


// Native fixtures are independently specified, including Graph's Sunday week
// default and inclusive end date; they are not produced by the forward helper.
const nativeDaily = {
  pattern: { type: "daily", interval: 1, dayOfMonth: 0, daysOfWeek: [], firstDayOfWeek: "sunday", index: "first", month: 0 },
  range: { type: "endDate", startDate: "2026-03-27", endDate: "2026-03-30", numberOfOccurrences: 0, recurrenceTimeZone: "Europe/Prague" },
};
const march = { ...event, ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-27T09:00:00", endLocal: "2026-03-27T10:00:00" }) };
const expanded = (master: typeof event, native: unknown, until = "2030-01-01T00:00:00Z") => expandRecurringEvents(
  [{ ...master, recurrence: recurrenceFromGraph(master, native) }], master.start, new Date(until), { consumerTimeZone: "Asia/Tokyo" },
).map(item => item.start.toISOString());
const unchanged = JSON.stringify(nativeDaily);
for (const hostZone of ["UTC", "America/New_York", "Asia/Tokyo"]) {
  const previous = process.env.TZ;
  try {
    process.env.TZ = hostZone;
    assert.deepEqual(expanded(march, nativeDaily), ["2026-03-27T08:00:00.000Z", "2026-03-28T08:00:00.000Z", "2026-03-29T07:00:00.000Z", "2026-03-30T07:00:00.000Z"]);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}
assert.equal(JSON.stringify(nativeDaily), unchanged);
const nativeRule = (pattern: object, count = 3) => ({ pattern, range: { type: "numbered", startDate: "2026-03-02", numberOfOccurrences: count, endDate: "0001-01-01" } });
for (const [pattern, expected] of [
  [{ type: "daily", interval: 2 }, ["2026-03-02T08:00:00.000Z", "2026-03-04T08:00:00.000Z", "2026-03-06T08:00:00.000Z"]],
  [{ type: "weekly", interval: 2, daysOfWeek: ["monday", "wednesday"], firstDayOfWeek: "monday" }, ["2026-03-02T08:00:00.000Z", "2026-03-04T08:00:00.000Z", "2026-03-16T08:00:00.000Z"]],
  [{ type: "absoluteMonthly", interval: 1, dayOfMonth: 2 }, ["2026-03-02T08:00:00.000Z", "2026-04-02T07:00:00.000Z", "2026-05-02T07:00:00.000Z"]],
  [{ type: "relativeMonthly", interval: 1, daysOfWeek: ["monday"] }, ["2026-03-02T08:00:00.000Z", "2026-04-06T07:00:00.000Z", "2026-05-04T07:00:00.000Z"]],
  [{ type: "absoluteYearly", interval: 1, dayOfMonth: 2, month: 3 }, ["2026-03-02T08:00:00.000Z", "2027-03-02T08:00:00.000Z", "2028-03-02T08:00:00.000Z"]],
  [{ type: "relativeYearly", interval: 1, daysOfWeek: ["monday"], index: "first", month: 3 }, ["2026-03-02T08:00:00.000Z", "2027-03-01T08:00:00.000Z", "2028-03-06T08:00:00.000Z"]],
] as const) assert.deepEqual(expanded(event, nativeRule(pattern)), expected);
const sunday = { ...event, ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-01T09:00:00", endLocal: "2026-03-01T10:00:00" }) };
assert.deepEqual(expanded(sunday, {
  pattern: { type: "weekly", interval: 2, daysOfWeek: ["sunday", "monday"] },
  range: { type: "numbered", startDate: "2026-03-01", numberOfOccurrences: 4 },
}), ["2026-03-01T08:00:00.000Z", "2026-03-02T08:00:00.000Z", "2026-03-15T08:00:00.000Z", "2026-03-16T08:00:00.000Z"]);
assert.deepEqual(expanded(allDay, {
  pattern: { type: "daily", interval: 1 }, range: { type: "endDate", startDate: "2026-03-02", endDate: "2026-03-04", recurrenceTimeZone: "UTC" },
}), ["2026-03-02T00:00:00.000Z", "2026-03-03T00:00:00.000Z", "2026-03-04T00:00:00.000Z"]);
assert.equal(recurrenceFromGraph(event, { pattern: { type: "daily", interval: 1 }, range: { type: "noEnd", startDate: "2026-03-02", numberOfOccurrences: 0 } }), "RRULE:FREQ=DAILY;INTERVAL=1");
const fall = { ...event, ...resolveEventTimeEdit({ kind: "zoned", timeZone: "America/New_York", startLocal: "2026-10-31T09:00:00", endLocal: "2026-10-31T10:00:00" }) };
assert.deepEqual(expanded(fall, { pattern: { type: "daily", interval: 1 }, range: { type: "endDate", startDate: "2026-10-31", endDate: "2026-11-02", recurrenceTimeZone: "America/New_York" } }), ["2026-10-31T13:00:00.000Z", "2026-11-01T14:00:00.000Z", "2026-11-02T14:00:00.000Z"]);
const baseNative = nativeRule({ type: "daily", interval: 1 });
for (const pattern of [
  { type: "hourly", interval: 1 }, { type: "daily", interval: 0 }, { type: "daily", interval: 1.5 }, { type: "daily", interval: 2147483648 },
  { type: "daily", interval: "1" }, { type: "daily", interval: 1, extension: true },
  { type: "daily", interval: 1, dayOfMonth: 2 }, { type: "daily", interval: 1, month: 3 },
  { type: "daily", interval: 1, daysOfWeek: ["monday"] }, { type: "daily", interval: 1, firstDayOfWeek: "monday" },
  { type: "daily", interval: 1, index: "last" }, { type: "weekly", interval: 1 },
  { type: "weekly", interval: 1, daysOfWeek: ["monday", "monday"] }, { type: "weekly", interval: 1, daysOfWeek: ["tuesday"] },
  { type: "relativeMonthly", interval: 1, daysOfWeek: ["monday", "tuesday"] }, { type: "relativeMonthly", interval: 1, daysOfWeek: ["monday"], index: "last" },
  { type: "absoluteMonthly", interval: 1, dayOfMonth: 31 }, { type: "absoluteMonthly", interval: 1 },
  { type: "absoluteYearly", interval: 1, dayOfMonth: 2, month: 4 },
]) assert.throws(() => recurrenceFromGraph(event, { ...baseNative, pattern }));
for (const range of [
  { type: "numbered", startDate: "2026-03-03", numberOfOccurrences: 3 },
  { type: "numbered", startDate: "2026-03-02", numberOfOccurrences: 0 },
  { type: "numbered", startDate: "2026-03-02", numberOfOccurrences: 3, endDate: "2026-03-30" },
  { type: "numbered", startDate: "2026-03-02", numberOfOccurrences: 3, recurrenceTimeZone: "Central Europe Standard Time" },
  { type: "noEnd", startDate: "2026-03-02", numberOfOccurrences: 3 },
  { type: "noEnd", startDate: "2026-03-02", futureOption: true },
  { type: "endDate", startDate: "2026-03-02" }, { type: "endDate", startDate: "2026-03-02", endDate: "2026-02-30" },
  { type: "endDate", startDate: "2026-03-02", endDate: "2026-03-01" },
]) assert.throws(() => recurrenceFromGraph(event, { ...baseNative, range }));
for (const native of [null, [], { ...baseNative, extra: true }, { ...baseNative, pattern: null }, { ...baseNative, range: null }]) assert.throws(() => recurrenceFromGraph(event, native));
for (const master of [
  { ...event, isAllDay: true }, { ...event, timeModel: { kind: "legacy-unknown" as const } },
  { ...event, seriesID: "00000000-0000-4000-8000-000000000199" },
  { ...event, originalStart: { kind: "instant" as const, value: event.start.toISOString() } },
  { ...event, ...resolveEventTimeEdit({ kind: "floating", startLocal: "2026-03-02T09:00:00", endLocal: "2026-03-02T10:00:00" }) },
]) assert.throws(() => recurrenceFromGraph(master, baseNative));
const gap = { ...event, ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-02T02:30:00", endLocal: "2026-03-02T03:30:00" }) };
assert.throws(() => recurrenceFromGraph(gap, { ...baseNative, range: { type: "endDate", startDate: "2026-03-02", endDate: "2026-03-29" } }), /cutoff/);
console.log("Native Graph recurrence candidates: independently expanded patterns, inclusive dates, Sunday default, DST and conservative refusals: OK");
