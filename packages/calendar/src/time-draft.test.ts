import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventSchema, eventUpdateOperation, eventPatchRequest } from "@musubi/types";
import { knownEventTimeDraft, editKnownEventTime } from "./time-draft";
import { resolveEventTimeEdit } from "./time-edit";

if (!process.env.MUSUBI_DRAFT_TZ_CHILD) {
  for (const TZ of ["UTC", "Europe/Prague", "America/New_York"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", import.meta.filename], { env: { ...process.env, TZ, MUSUBI_DRAFT_TZ_CHILD: "1" }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
} else {
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, process.env.TZ);
  const allDay = EventSchema.parse({ ...resolveEventTimeEdit({ kind: "all-day", startDate: "2026-03-28", endDate: "2026-03-29" }), id: "00000000-0000-4000-8000-000000000152", revision: 1, title: "Dates", color: "red", creatorID: "owner", organizer: "owner", calendars: ["home"], isCanceled: false });
  const dateWrite = editKnownEventTime(allDay, allDay, { ...knownEventTimeDraft(allDay)!, endDate: "2026-03-30" });
  assert.equal(dateWrite.end.toISOString(), "2026-03-30T00:00:00.000Z");
  assert.deepEqual(eventUpdateOperation(dateWrite).body, { expectedRevision: 1, time: { kind: "all-day", startDate: "2026-03-28", endDate: "2026-03-30" }, patch: {} });
  for (const kind of ["zoned", "floating"] as const) {
    const time = { kind, ...(kind === "zoned" ? { timeZone: "Europe/Prague" } : {}), startLocal: "2026-03-29T02:30:17.123", endLocal: "2026-03-29T04:30:19.456" };
    const event = EventSchema.parse({ ...resolveEventTimeEdit(time), id: "00000000-0000-4000-8000-000000000151", revision: 3, title: "Before", color: "red", creatorID: "owner", organizer: "owner", calendars: ["home"], isCanceled: false });
    const draft = knownEventTimeDraft(event)!;
    assert.equal(draft.startTime, "02:30");
    assert.deepEqual(eventUpdateOperation(editKnownEventTime(event, { ...event, title: "Title only" }, draft)).body, { id: event.id, expectedRevision: 3, patch: { title: "Title only" } });
    const saved = editKnownEventTime(event, { ...event, title: "Together" }, { ...draft, date: "2026-03-30", endDate: "2026-03-30" });
    const operation = eventUpdateOperation(saved);
    assert.equal(operation.method, "PUT");
    assert.equal(operation.path, `/events/${event.id}/time`);
    assert.deepEqual(operation.body, { expectedRevision: 3, time: { ...time, startLocal: "2026-03-30T02:30:17.123", endLocal: "2026-03-30T04:30:19.456" }, patch: { title: "Together" } });
    assert.throws(() => eventPatchRequest(saved), /atomic time edit/);
    assert.throws(() => eventUpdateOperation({ ...saved, contentPatch: { ...saved.contentPatch, calendars: ["elsewhere"] } }), /separately/);
    assert.throws(() => editKnownEventTime(event, event, { ...draft, date: "invalid" }), /valid dates/);
    assert.throws(() => editKnownEventTime({ ...event, recurrence: "FREQ=DAILY" }, { ...event, recurrence: "FREQ=DAILY" }, { ...draft, startTime: "01:30" }), /scope edit/);
  }
}
console.log("Civil editor drafts and atomic transport across host zones: OK");
