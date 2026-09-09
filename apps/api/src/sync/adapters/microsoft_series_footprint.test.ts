import assert from "node:assert/strict";
import { EventSchema } from "@musubi/types";
import { resolveEventTimeEdit } from "@musubi/calendar";
import { graphSeriesFootprint } from "./microsoft_series_footprint";

const base = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000181", revision: 1, creatorID: "owner", organizer: "", title: "Finite", color: "red", calendars: [], isCanceled: false, recurrence: "RRULE:FREQ=DAILY;COUNT=4", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-27T09:00:00", endLocal: "2026-03-27T10:00:00" }) });
const start = (event = base) => graphSeriesFootprint(event).map(item => item.start.toISOString());
const previous = JSON.stringify(base);
for (const zone of ["UTC", "America/New_York", "Asia/Tokyo"]) {
  const savedZone = process.env.TZ;
  try {
    process.env.TZ = zone;
    assert.deepEqual(start(), ["2026-03-27T08:00:00.000Z", "2026-03-28T08:00:00.000Z", "2026-03-29T07:00:00.000Z", "2026-03-30T07:00:00.000Z"]);
    assert.deepEqual(graphSeriesFootprint(base).map(item => item.originalStart), start().map(value => ({ kind: "instant", value })));
  } finally { if (savedZone === undefined) delete process.env.TZ; else process.env.TZ = savedZone; }
}
assert.equal(JSON.stringify(base), previous);
const dates = { ...base, ...resolveEventTimeEdit({ kind: "all-day", startDate: "2026-12-31", endDate: "2027-01-02" }) };
assert.deepEqual(graphSeriesFootprint(dates).map(item => [item.originalStart, item.end.toISOString()]), [
  [{ kind: "date", value: "2026-12-31" }, "2027-01-02T00:00:00.000Z"],
  [{ kind: "date", value: "2027-01-01" }, "2027-01-03T00:00:00.000Z"],
  [{ kind: "date", value: "2027-01-02" }, "2027-01-04T00:00:00.000Z"],
  [{ kind: "date", value: "2027-01-03" }, "2027-01-05T00:00:00.000Z"],
]);
assert.equal(start({ ...base, recurrence: "FREQ=DAILY;COUNT=1" }).length, 1);
assert.equal(start({ ...base, recurrence: "FREQ=DAILY;COUNT=366" }).length, 366);
assert.equal(start({ ...base, recurrence: "FREQ=WEEKLY;COUNT=105" }).length, 105);
const monthly = { ...base, ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-02T09:00:00", endLocal: "2026-03-02T10:00:00" }) };
for (const recurrence of ["FREQ=MONTHLY;BYMONTHDAY=2;COUNT=3", "FREQ=MONTHLY;BYDAY=1MO;COUNT=3", "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=2;COUNT=2", "FREQ=YEARLY;BYMONTH=3;BYDAY=1MO;COUNT=2"]) assert.ok(graphSeriesFootprint({ ...monthly, recurrence }).length >= 2);
for (const recurrence of ["FREQ=DAILY", "FREQ=DAILY;COUNT=367", "FREQ=WEEKLY;COUNT=106", "FREQ=YEARLY;COUNT=4", "FREQ=DAILY;COUNT=0"]) {
  const event = { ...base, recurrence };
  assert.throws(() => graphSeriesFootprint(event));
}
for (const [zone, startLocal, endLocal] of [
  ["Europe/Prague", "2026-03-28T02:30:00", "2026-03-28T03:30:00"],
  ["Europe/Prague", "2026-10-24T02:30:00", "2026-10-24T03:30:00"],
  ["Europe/Prague", "2026-10-24T01:30:00", "2026-10-24T02:30:00"],
  ["Europe/Prague", "2026-03-28T01:30:00", "2026-03-28T03:30:00"],
  ["Australia/Lord_Howe", "2026-04-04T01:45:00", "2026-04-04T02:45:00"],
  ["Australia/Lord_Howe", "2026-10-03T02:15:00", "2026-10-03T03:15:00"],
  ["Europe/Prague", "2026-03-27T23:00:00", "2026-03-28T00:00:00"],
  ["Europe/Prague", "2026-03-27T09:00:00", "2026-03-27T09:00:00"],
]) assert.throws(() => graphSeriesFootprint({ ...base, ...resolveEventTimeEdit({ kind: "zoned", timeZone: zone!, startLocal: startLocal!, endLocal: endLocal! }) }), `${zone} ${startLocal} → ${endLocal}`);
assert.throws(() => graphSeriesFootprint({ ...base, isCanceled: true }));
assert.throws(() => graphSeriesFootprint({ ...base, ...resolveEventTimeEdit({ kind: "floating", startLocal: "2026-03-27T09:00:00", endLocal: "2026-03-27T10:00:00" }) }));
const boundary = { ...base, recurrence: "FREQ=DAILY;COUNT=1", ...resolveEventTimeEdit({ kind: "all-day", startDate: "2026-01-01", endDate: "2027-12-31" }) };
assert.equal(graphSeriesFootprint(boundary).length, 1);
assert.throws(() => graphSeriesFootprint({ ...boundary, ...resolveEventTimeEdit({ kind: "all-day", startDate: "2026-01-01", endDate: "2028-01-01" }) }));
const detached = graphSeriesFootprint(base); detached[0]!.start.setUTCFullYear(2030);
assert.equal(JSON.stringify(base), previous); assert.equal(start()[0], "2026-03-27T08:00:00.000Z");
console.log("Finite Graph series footprint: complete original identities, COUNT/horizon bounds, six patterns, all-day inclusive end, host-zone independence, future gap/fold/non-hour transitions and duration refusals: OK");

const until = { ...base, recurrence: "FREQ=DAILY;UNTIL=20260330T070000Z" };
assert.deepEqual(graphSeriesFootprint(until), graphSeriesFootprint(base));
assert.deepEqual(graphSeriesFootprint({ ...dates, recurrence: "FREQ=DAILY;UNTIL=20270103" }), graphSeriesFootprint(dates));
assert.equal(graphSeriesFootprint({ ...until, recurrence: "FREQ=DAILY;UNTIL=20260330T065959Z" }).length, 3);
for (const recurrence of ["FREQ=DAILY;UNTIL=20290330T070000Z", "FREQ=DAILY;UNTIL=20270330T070000Z", "FREQ=DAILY;UNTIL=20260326T070000Z", "FREQ=DAILY;UNTIL=20260230T070000Z", "FREQ=DAILY;UNTIL=20260330", "FREQ=DAILY;UNTIL=20260330T070000", "FREQ=DAILY;COUNT=4;UNTIL=20260330T070000Z"]) assert.throws(() => graphSeriesFootprint({ ...base, recurrence }));
for (const [zone, startLocal, endLocal, cutoff] of [
  ["Europe/Prague", "2026-03-28T02:30:00", "2026-03-28T03:30:00", "20260331T070000Z"],
  ["Europe/Prague", "2026-10-24T02:30:00", "2026-10-24T03:30:00", "20261027T070000Z"],
  ["Australia/Lord_Howe", "2026-04-04T01:45:00", "2026-04-04T02:45:00", "20260407T070000Z"],
]) assert.throws(() => graphSeriesFootprint({ ...base, recurrence: `FREQ=DAILY;UNTIL=${cutoff}`, ...resolveEventTimeEdit({ kind: "zoned", timeZone: zone!, startLocal: startLocal!, endLocal: endLocal! }) }));
// An ambiguous/fractional inverse cutoff must fail before any native request.
assert.throws(() => graphSeriesFootprint({ ...until, ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-27T09:00:00.500", endLocal: "2026-03-27T10:00:00.500" }) }));
console.log("Graph finite UNTIL matches COUNT through exact forward/reverse native ranges; gap/fold/cutoff/overflow cases fail closed: OK");
