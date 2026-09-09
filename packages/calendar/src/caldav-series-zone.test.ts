import assert from "node:assert/strict";
import { EventSchema } from "@musubi/types";
import { assertCaldavSeriesUTCConversion } from "./caldav-series-zone";
import { expandRecurringEvents } from "./recurrence";
import { finiteSeriesFootprint } from "./finite-series";
import { resolveEventTimeEdit } from "./time-edit";
import { editEventTimeDraft, knownEventTimeDraft } from "./time-draft";
import { eventScopeRequest } from "./scope-request";

const master = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000001", isCanceled: false, revision: 3, creatorID: "owner", organizer: "", title: "Daily", color: "red", calendars: [], recurrence: "RRULE:FREQ=DAILY;COUNT=4", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-28T09:00:00", endLocal: "2026-03-28T10:00:00" }) });
const time = { kind: "zoned" as const, timeZone: "UTC", startLocal: "2026-03-28T09:00:00.000", endLocal: "2026-03-28T10:00:00.000" };
assertCaldavSeriesUTCConversion(master, time);
const before = finiteSeriesFootprint(master), after = finiteSeriesFootprint({ ...master, ...resolveEventTimeEdit(time) });
assert.deepEqual(before.map(slot => slot.start.toISOString()), ["2026-03-28T08:00:00.000Z", "2026-03-29T07:00:00.000Z", "2026-03-30T07:00:00.000Z", "2026-03-31T07:00:00.000Z"]);
assert.deepEqual(after.map(slot => slot.start.toISOString()), ["2026-03-28T09:00:00.000Z", "2026-03-29T09:00:00.000Z", "2026-03-30T09:00:00.000Z", "2026-03-31T09:00:00.000Z"]);
// Both existing clients use the same explicit picker draft and scope helper.
for (const occurrence of [master, { ...master, ...resolveEventTimeEdit({ ...time, timeZone: "Europe/Prague", startLocal: "2026-03-29T09:00:00.000", endLocal: "2026-03-29T10:00:00.000" }) }]) {
  const draft = editEventTimeDraft(occurrence, occurrence, { ...knownEventTimeDraft(occurrence)!, timeZone: "UTC" });
  const request = eventScopeRequest(master, occurrence, "series", draft);
  assert.equal(request.action, "update");
  if (request.action !== "update") throw new Error();
  assert.deepEqual(request.time, time); assert.deepEqual(request.patch, {});
  assert.equal(eventScopeRequest(master, occurrence, "series", draft).operationID, request.operationID);
  assert.throws(() => eventScopeRequest(master, occurrence, "series", { ...draft, timeEdit: { ...time, startLocal: "2026-03-28T08:00:00.000" } }));
}
for (const recurrence of ["RRULE:FREQ=DAILY", "RRULE:FREQ=DAILY;UNTIL=20260401T070000Z", "RRULE:FREQ=DAILY;COUNT=367", "RRULE:FREQ=YEARLY;COUNT=4", "RRULE:FREQ=DAILY;COUNT=4\nEXDATE:20260329T070000Z", "RRULE:FREQ=DAILY;COUNT=4;COUNT=5"])
  assert.throws(() => assertCaldavSeriesUTCConversion({ ...master, recurrence }, time));
for (const date of ["2026-03-28", "2026-10-24"]) {
  const ambiguous = { ...master, ...resolveEventTimeEdit({ ...time, timeZone: "Europe/Prague", startLocal: date + "T02:30:00.000", endLocal: date + "T03:30:00.000" }) };
  assert.throws(() => assertCaldavSeriesUTCConversion(ambiguous, { ...time, startLocal: date + "T02:30:00.000", endLocal: date + "T03:30:00.000" }));
}
for (const changed of [{ ...time, timeZone: "America/New_York" }, { ...time, startLocal: "2026-03-28T08:00:00.000" }, { kind: "floating" as const, startLocal: time.startLocal, endLocal: time.endLocal }]) assert.throws(() => assertCaldavSeriesUTCConversion(master, changed));
console.log("CalDAV UTC conversion: complete wall-clock footprint, DST, explicit shared client intent and bounded refusals: OK");

const short = { ...master, recurrence: "FREQ=DAILY;COUNT=2", ...resolveEventTimeEdit({ ...time, timeZone: "Europe/Prague", startLocal: "2026-10-23T02:30:00.000", endLocal: "2026-10-23T03:30:00.000" }) };
const last = expandRecurringEvents([short], new Date("2026-10-24T00:00:00Z"), new Date("2026-10-24T23:59:59Z"), { consumerTimeZone: "UTC" })[0]!;
assert.equal(last.id, short.id + "_" + Date.parse("2026-10-24T00:30:00Z"));
for (const displayed of [last, { ...last, id: short.id }]) {
  const draft = editEventTimeDraft(displayed, displayed, { ...knownEventTimeDraft(displayed)!, timeZone: "UTC" });
  const request = eventScopeRequest(short, displayed, "series", draft);
  assert.equal(request.action, "update");
  if (request.action === "update") assert.deepEqual(request.time, { ...time, startLocal: "2026-10-23T02:30:00.000", endLocal: "2026-10-23T03:30:00.000" });
  // The real family with the extra fold slot is still refused at scope admission.
  assert.throws(() => eventScopeRequest({ ...short, recurrence: "FREQ=DAILY;COUNT=3" }, displayed, "series", draft));
}
