import assert from "node:assert/strict";
import { EventSchema, EventScopeRequestSchema, type Event } from "@musubi/types";
import { expandRecurringEvents } from "./recurrence";
import { resolveEventTimeEdit } from "./time-edit";
import { planEventScope, type EventScopePlan } from "./scope-plan";
const master = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000001", revision: 4, creatorID: "owner", organizer: "", title: "Master", color: "#7A8BA3", calendars: ["00000000-0000-4000-8000-000000000010"], isCanceled: false, recurrence: "RRULE:FREQ=DAILY;COUNT=4", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-28T09:00:00", endLocal: "2026-03-28T10:00:00" }) });
const operationID = "00000000-0000-4000-8000-000000000020";
const newID = () => "00000000-0000-4000-8000-000000000002";
const originalStart = { kind: "instant" as const, value: "2026-03-29T07:00:00.000Z" };
const occurrence = { operationID, expectedRevision: 4, scope: "occurrence", originalStart, expectedOccurrenceRevision: null };
const apply = (master: Event, children: Event[], plan: EventScopePlan) => {
  const result = new Map([master, ...children].map(event => [event.id, event]));
  for (const id of plan.deletes) result.delete(id);
  for (const event of [...plan.updates, ...plan.creates]) result.set(event.id, event);
  return [...result.values()];
};
const expand = (events: Event[]) => expandRecurringEvents(events, new Date("2026-03-27T00:00Z"), new Date("2026-04-05T00:00Z"), { consumerTimeZone: "America/New_York" });
const before = structuredClone(master);
const cancelled = planEventScope(master, [], { ...occurrence, action: "delete" }, newID);
assert.equal(cancelled.creates[0]!.isCanceled, true);
assert.equal(expand(apply(master, [], cancelled)).length, 3);
assert.deepEqual(master, before);
const move = planEventScope(master, [], { ...occurrence, action: "update", patch: { title: "Moved" }, time: { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-29T14:00:00", endLocal: "2026-03-29T16:00:00" } }, newID);
const moved = { ...move.creates[0]!, revision: 7 };
assert.equal(expand(apply(master, [], move)).length, 4);
assert.equal(moved.start.toISOString(), "2026-03-29T12:00:00.000Z");
assert.equal(moved.end.getTime() - moved.start.getTime(), 7200000);
assert.deepEqual(moved.originalStart, originalStart);
assert.throws(() => planEventScope(master, [moved], { ...occurrence, action: "delete" }, newID), /occurrence revision/);
const removeMoved = planEventScope(master, [moved], { ...occurrence, expectedOccurrenceRevision: 7, action: "delete" }, newID);
assert.equal(removeMoved.updates[1]!.id, moved.id);
assert.equal(removeMoved.updates[1]!.isCanceled, true);
assert.deepEqual(planEventScope(master, [moved], { operationID, expectedRevision: 4, scope: "series", action: "delete" }).deletes, [master.id, moved.id]);
const following = { ...occurrence, scope: "following", action: "update", patch: { title: "Future" } };
const split = planEventScope(master, [], following, newID);
assert.equal(split.updates[0]!.recurrence, "RRULE:FREQ=DAILY;COUNT=1");
assert.equal(split.creates[0]!.recurrence, "RRULE:FREQ=DAILY;COUNT=3");
assert.deepEqual(expand(apply(master, [], split)).map(event => event.start.toISOString()).sort(), expand([master]).map(event => event.start.toISOString()).sort());
const splitMoved = planEventScope(master, [moved], { ...following, expectedOccurrenceRevision: 7 }, () => "00000000-0000-4000-8000-000000000003");
assert.equal(splitMoved.updates.find(event => event.id === moved.id)!.seriesID, splitMoved.creates[0]!.id);
assert.equal(expand(apply(master, [moved], splitMoved)).length, 4);
assert.equal(splitMoved.updates.find(event => event.id === moved.id)!.start.toISOString(), moved.start.toISOString());
const shifted = planEventScope(master, [moved], { operationID, expectedRevision: 4, scope: "series", action: "update", patch: {}, time: { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-28T10:00:00", endLocal: "2026-03-28T11:00:00" } });
assert.deepEqual(shifted.updates[1]!.originalStart, { kind: "instant", value: "2026-03-29T08:00:00.000Z" });
assert.equal(shifted.updates[1]!.start.toISOString(), moved.start.toISOString());
assert.equal(expand(apply(master, [moved], shifted)).length, 4);
const deleteFollowing = planEventScope(master, [moved], { ...occurrence, scope: "following", action: "delete", expectedOccurrenceRevision: 7 });
assert.equal(expand(apply(master, [moved], deleteFollowing)).length, 1);
for (const rule of ["RRULE:FREQ=DAILY;COUNT=4", "RRULE:FREQ=DAILY;UNTIL=20260331T070000Z"]) {
  const event = { ...master, recurrence: rule };
  const plan = planEventScope(event, [], following, newID);
  assert.deepEqual(expand(apply(event, [], plan)).map(event => event.start.toISOString()).sort(), expand([event]).map(event => event.start.toISOString()).sort());
}
const first = planEventScope(master, [], { ...following, originalStart: { kind: "instant", value: master.start.toISOString() } }, newID);
assert.equal(first.creates.length, 0);
assert.equal(first.updates[0]!.id, master.id);
assert.throws(() => planEventScope(master, [], { ...occurrence, action: "delete", expectedRevision: 3 }), /series revision/);
assert.equal(EventScopeRequestSchema.safeParse({ ...occurrence, action: "delete", patch: { title: "Bad" } }).success, false);
assert.equal(EventScopeRequestSchema.safeParse({ ...occurrence, action: "update", patch: { recurrence: null } }).success, false);
console.log("Scope plans: original identity, CAS, move/cancel, all scopes, COUNT/UNTIL and DST: OK");
for (const time of [
  { kind: "all-day", startDate: "2026-03-28", endDate: "2026-03-28" },
  { kind: "floating", startLocal: "2026-03-28T09:00:00", endLocal: "2026-03-28T10:00:00" },
]) {
  const event = EventSchema.parse({ ...master, ...resolveEventTimeEdit(time) });
  const originalStart = time.kind === "all-day" ? { kind: "date", value: "2026-03-29" } : { kind: "floating", value: "2026-03-29T09:00:00.000" };
  for (const scope of ["occurrence", "following", "series"]) {
    const identity = scope === "series" ? {} : { originalStart, expectedOccurrenceRevision: null };
    const request = { operationID, expectedRevision: 4, scope, ...identity };
    const update = planEventScope(event, [], { ...request, action: "update", patch: { title: "Changed" } }, newID);
    assert.equal(expand(apply(event, [], update)).length, 4);
    const removal = planEventScope(event, [], { ...request, action: "delete" }, newID);
    assert.equal(expand(apply(event, [], removal)).length, scope === "occurrence" ? 3 : scope === "following" ? 1 : 0);
    assert.deepEqual(planEventScope(event, [], { ...request, action: "update", patch: {} }, newID), { updates: [], creates: [], deletes: [] });
  }
}
const gap = EventSchema.parse({ ...master, recurrence: "RRULE:FREQ=DAILY;COUNT=3", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-28T02:30:00", endLocal: "2026-03-28T03:30:00" }) });
const gapSplit = planEventScope(gap, [], { ...following, originalStart: { kind: "instant", value: "2026-03-30T00:30:00.000Z" } }, newID);
assert.equal(gapSplit.updates[0]!.recurrence, "RRULE:FREQ=DAILY;COUNT=1");
assert.equal(gapSplit.creates[0]!.recurrence, "RRULE:FREQ=DAILY;COUNT=2");
assert.deepEqual(expand(apply(gap, [], gapSplit)).map(event => event.start.toISOString()).sort(), expand([gap]).map(event => event.start.toISOString()).sort());
assert.throws(() => planEventScope(master, [], { ...occurrence, action: "delete" }, () => master.id), /reuse an existing ID/);
assert.throws(() => planEventScope({ ...master, recurrence: master.recurrence + "\nEXDATE:20260330T070000Z" }, [], following, newID), /one RRULE/);
const foldMaster = EventSchema.parse({ ...master, recurrence: "RRULE:FREQ=DAILY;COUNT=3\nRDATE:20261025T013000Z", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-10-24T02:30:00", endLocal: "2026-10-24T03:30:00" }) });
const foldChild = EventSchema.parse({ ...moved, seriesID: master.id, originalStart: { kind: "instant", value: "2026-10-25T01:30:00.000Z" }, ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-10-25T14:00:00", endLocal: "2026-10-25T16:00:00" }) });
const titleOnly = planEventScope(foldMaster, [foldChild], { operationID, expectedRevision: 4, scope: "series", action: "update", patch: { title: "New" } });
assert.deepEqual(titleOnly.updates[1]!.originalStart, foldChild.originalStart, "Title-only edit preserves the exact second fold identity");
assert.throws(() => planEventScope(foldMaster, [foldChild], { operationID, expectedRevision: 4, scope: "series", action: "update", patch: {}, time: { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-10-24T04:30:00", endLocal: "2026-10-24T05:30:00" } }), /date reconciliation/);
const lowercase = planEventScope({ ...master, recurrence: "rrule:freq=daily;count=4" }, [], following, newID);
assert.equal(lowercase.creates[0]!.recurrence, "RRULE:FREQ=DAILY;COUNT=3");
const lateChild = { ...moved, originalStart: { kind: "instant" as const, value: "2026-03-31T07:00:00.000Z" } };
assert.throws(() => planEventScope(master, [lateChild], { operationID, expectedRevision: 4, scope: "series", action: "update", patch: { recurrence: "RRULE:FREQ=DAILY;COUNT=2" } }), /orphan/);
assert.throws(() => planEventScope(master, [lateChild], { ...following, patch: { recurrence: "RRULE:FREQ=DAILY;COUNT=1" } }, () => "00000000-0000-4000-8000-000000000003"), /orphan/);
const gapChild = { ...moved, originalStart: { kind: "instant" as const, value: "2026-03-29T07:00:00.000Z" } };
assert.throws(() => planEventScope(master, [gapChild], { operationID, expectedRevision: 4, scope: "series", action: "update", patch: {}, time: { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-28T02:30:00", endLocal: "2026-03-28T03:30:00" } }), /orphan/);

const materialized = planEventScope(master, [], { ...occurrence, action: "update", patch: {}, ensureDefinition: true }, newID);
assert.equal(materialized.creates.length, 1, "a reminder target can materialize a generated occurrence without changing its content");
assert.equal(materialized.creates[0]!.title, master.title);
const materializedFollowing = planEventScope(master, [], { ...occurrence, scope: "following", action: "update", patch: {}, ensureDefinition: true }, newID);
assert.equal(materializedFollowing.creates.length, 1, "reminder-only following has its own head");
assert.equal(materializedFollowing.creates[0]!.recurrence, "RRULE:FREQ=DAILY;COUNT=3");
assert.equal(planEventScope(master, [], { ...occurrence, action: "update", patch: {} }, newID).creates.length, 0, "ordinary no-op remains a no-op");
