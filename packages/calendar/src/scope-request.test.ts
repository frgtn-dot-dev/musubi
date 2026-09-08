import assert from "node:assert/strict";
import { EventSchema } from "@musubi/types";
import { eventScopeRequest } from "./scope-request";
import { resolveEventTimeEdit } from "./time-edit";
import { knownEventTimeDraft, editEventTimeDraft } from "./time-draft";
const master = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000001", isCanceled: false, revision: 3, creatorID: "owner", organizer: "", title: "Daily", color: "red", calendars: [], recurrence: "RRULE:FREQ=DAILY;COUNT=4", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-28T09:00:00", endLocal: "2026-03-28T10:00:00" }) });
const occurrence = { ...master, ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-29T09:00:00", endLocal: "2026-03-29T10:00:00" }) };
const edited = editEventTimeDraft(occurrence, { ...occurrence, title: "Moved" }, { ...knownEventTimeDraft(occurrence)!, startTime: "10:00", endTime: "12:00" });
for (const scope of ["occurrence", "following", "series"] as const) {
  const request = eventScopeRequest(master, occurrence, scope, edited);
  assert.equal(eventScopeRequest(master, occurrence, scope, edited).operationID, request.operationID);
  assert.equal(request.action, "update");
  if (request.action !== "update") throw new Error();
  assert.deepEqual(request.patch, { title: "Moved" });
  if (request.time?.kind !== "zoned") throw new Error();
  assert.equal(request.time.startLocal, scope === "series" ? "2026-03-28T10:00:00.000" : "2026-03-29T10:00:00.000");
  if (scope !== "series") { assert.equal(request.expectedOccurrenceRevision, null); assert.deepEqual(request.originalStart, { kind: "instant", value: "2026-03-29T07:00:00.000Z" }); }
}
const child = { ...occurrence, id: "00000000-0000-4000-8000-000000000002", seriesID: master.id, recurrence: null, revision: 7, originalStart: { kind: "instant" as const, value: "2026-03-29T07:00:00.000Z" }, ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-30T14:00:00", endLocal: "2026-03-30T16:00:00" }) };
const cancel = eventScopeRequest(master, child, "occurrence");
assert.equal(cancel.expectedOccurrenceRevision, 7);
assert.deepEqual(cancel.originalStart, child.originalStart);
assert.equal(eventScopeRequest(master, child, "occurrence").operationID, cancel.operationID);
assert.throws(() => eventScopeRequest({ ...master, revision: 4 }, occurrence, "series", edited), /changed/);
assert.throws(() => eventScopeRequest(master, occurrence, "series", { ...edited, calendars: ["different"] }), /Unrecognized/);
console.log("Scope client intent: stable retry, frozen CAS, civil master shift and moved original identity: OK");
