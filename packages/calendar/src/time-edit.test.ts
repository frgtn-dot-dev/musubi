import assert from "node:assert/strict";
import { expandRecurringEvents } from "./recurrence";
import { resolveEventTimeEdit } from "./time-edit";

const zoned = (timeZone: string, startLocal: string, endLocal: string) =>
  resolveEventTimeEdit({ kind: "zoned", timeZone, startLocal, endLocal });

for (const [zone, startLocal, endLocal, start, end] of [
  ["Europe/Prague", "2026-03-29T02:30:00", "2026-03-29T04:30:00", "2026-03-29T01:30:00.000Z", "2026-03-29T02:30:00.000Z"],
  ["Europe/Prague", "2026-10-25T02:15:00", "2026-10-25T03:15:00", "2026-10-25T00:15:00.000Z", "2026-10-25T02:15:00.000Z"],
  ["America/New_York", "2026-03-08T02:30:00", "2026-03-08T04:30:00", "2026-03-08T07:30:00.000Z", "2026-03-08T08:30:00.000Z"],
  ["Australia/Lord_Howe", "2026-10-04T02:15:00", "2026-10-04T03:15:00", "2026-10-03T15:45:00.000Z", "2026-10-03T16:15:00.000Z"],
]) {
  const result = zoned(zone, startLocal, endLocal);
  assert.equal(result.start.toISOString(), start);
  assert.equal(result.end.toISOString(), end);
  assert.equal(result.isAllDay, false);
  assert.equal(result.timeModel.kind === "zoned" && result.timeModel.startLocal, `${startLocal}.000`);
}
assert.throws(() => zoned("Europe/Prague", "2026-03-29T02:45:00", "2026-03-29T03:15:00"), /end must not precede/);
assert.throws(() => zoned("Europe/Prague", "2026-10-25T02:45:00", "2026-10-25T02:15:00"), /end must not precede/);
const allDay = resolveEventTimeEdit({ kind: "all-day", startDate: "2026-03-28", endDate: "2026-03-30" });
assert.equal(allDay.start.toISOString(), "2026-03-28T00:00:00.000Z");
assert.equal(allDay.end.toISOString(), "2026-03-30T00:00:00.000Z");
assert.equal(allDay.isAllDay, true);
assert.deepEqual(allDay.timeModel, { kind: "all-day" });

const input = { kind: "floating", startLocal: "2026-03-29T09:00:00.1", endLocal: "2026-03-29T10:00:00.1" };
const before = structuredClone(input);
const floating = resolveEventTimeEdit(input);
assert.deepEqual(input, before);
assert.equal(floating.start.toISOString(), "2026-03-29T09:00:00.100Z");
assert.equal(floating.end.toISOString(), "2026-03-29T10:00:00.100Z");
const event = { id: "00000000-0000-4000-8000-000000000001", title: "Floating", ...floating };
for (const [zone, expected] of [["Europe/Prague", "2026-03-29T07:00:00.100Z"], ["America/New_York", "2026-03-29T13:00:00.100Z"]]) {
  const result = expandRecurringEvents([event], new Date("2026-03-28T00:00:00Z"), new Date("2026-03-31T00:00:00Z"), { consumerTimeZone: zone });
  assert.equal(result.length, 1);
  assert.equal(result[0].start.toISOString(), expected);
}

// An explicit gap remains the civil series anchor after the write projection.
const series = { id: event.id, title: "Series", ...zoned("Europe/Prague", "2026-03-29T02:30:00", "2026-03-29T04:30:00"), recurrence: "FREQ=DAILY;COUNT=2" };
const expanded = expandRecurringEvents([series], new Date("2026-03-29T00:00:00Z"), new Date("2026-04-02T00:00:00Z"), { consumerTimeZone: "America/New_York" });
assert.deepEqual(expanded.map(event => event.start.toISOString()), ["2026-03-29T01:30:00.000Z", "2026-03-30T00:30:00.000Z"]);
console.log("Explicit event time edit: OK");
