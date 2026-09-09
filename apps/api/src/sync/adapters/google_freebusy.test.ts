import assert from "node:assert/strict";
import { AvailabilityRequestSchema } from "@musubi/types";
import { normalizeGoogleFreebusy, queryGoogleFreebusy } from "./google_freebusy";
const range = { start: "2026-10-25T00:00:00Z", end: "2026-10-26T00:00:00Z" };
const payload = (busy: unknown[]) => ({ kind: "calendar#freeBusy", timeMin: range.start, timeMax: range.end, calendars: { source: { busy } } });
assert.deepEqual(normalizeGoogleFreebusy(payload([]), "source", range), []);
assert.deepEqual(normalizeGoogleFreebusy(payload([
  { start: "2026-10-25T02:30:00+02:00", end: "2026-10-25T02:30:00+01:00" },
  { start: "2026-10-25T01:00:00Z", end: "2026-10-25T02:00:00Z" },
  { start: "2026-10-24T23:00:00Z", end: "2026-10-25T00:15:00Z" },
]), "source", range), [{ start: "2026-10-25T00:00:00.000Z", end: "2026-10-25T00:15:00.000Z" }, { start: "2026-10-25T00:30:00.000Z", end: "2026-10-25T02:00:00.000Z" }]);
for (const invalid of [null, { ...payload([]), timeMax: "2026-10-27T00:00:00Z" }, { ...payload([]), calendars: {} }, { ...payload([]), calendars: { source: { busy: [], errors: [{ reason: "unknown-new-reason" }] } } }, payload([{ start: range.end, end: range.start }]), payload([{ start: range.start, end: range.end, title: "Private" }])]) assert.throws(() => normalizeGoogleFreebusy(invalid, "source", range));
assert.equal(AvailabilityRequestSchema.safeParse({ ...range, end: "2027-01-01T00:00:00Z", sourceIds: ["00000000-0000-4000-8000-000000000001"] }).success, false);
async function main() {
  let requests = 0;
  const result = await queryGoogleFreebusy("synthetic", "source", range, AbortSignal.timeout(1000), async (url, init) => {
    requests++; assert.equal(url, "https://www.googleapis.com/calendar/v3/freeBusy"); assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(init?.body)), { timeMin: range.start, timeMax: range.end, timeZone: "UTC", calendarExpansionMax: 1, items: [{ id: "source" }] });
    return Response.json(payload([]));
  });
  assert.deepEqual(result, []); assert.equal(requests, 1);
  for (const response of [new Response("", { status: 503 }), new Response("{}", { status: 200, headers: { "Content-Range": "bytes 0-1/50" } }), new Response("{", { status: 200 })]) await assert.rejects(queryGoogleFreebusy("synthetic", "source", range, AbortSignal.timeout(1000), async () => response));
  console.log("Google free/busy HTTP: bounded interval-only reads, DST, union, errors and incomplete responses OK");
}
void main();
