import assert from "node:assert/strict";
import type { EventTimeModel, OccurrenceStart } from "@musubi/types";
import { buildInvitePreview } from "./invite_preview";

const calendar = { id: "calendar", name: "Preview", color: "red" };
const now = new Date("2026-03-27T12:00:00Z");
const master = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Morning",
  color: "red",
  start: new Date("2026-03-28T08:00:00Z"),
  end: new Date("2026-03-28T09:00:00Z"),
  isAllDay: false,
  recurrence: "FREQ=DAILY;COUNT=3",
  timeModel: {
    kind: "zoned",
    timeZone: "Europe/Prague",
    startLocal: "2026-03-28T09:00:00.000",
    endLocal: "2026-03-28T10:00:00.000",
  } satisfies EventTimeModel,
};
const detached = {
  ...master,
  id: "00000000-0000-4000-8000-000000000002",
  seriesID: master.id,
  originalStart: {
    kind: "instant",
    value: "2026-03-29T07:00:00.000Z",
  } satisfies OccurrenceStart,
  start: new Date("2026-03-29T07:00:00Z"),
  end: new Date("2026-03-29T08:00:00Z"),
  recurrence: null,
  timeModel: {
    ...master.timeModel,
    startLocal: "2026-03-29T09:00:00.000",
    endLocal: "2026-03-29T10:00:00.000",
  },
};
const preview = (
  definitions: Parameters<typeof buildInvitePreview>[2],
  at = now,
) => buildInvitePreview(calendar, [], definitions, at).events;
const zoned = preview([{ events: master }]);
assert.deepEqual(
  zoned.map((event) => event.start.toISOString()),
  [
    "2026-03-28T08:00:00.000Z",
    "2026-03-29T07:00:00.000Z",
    "2026-03-30T07:00:00.000Z",
  ],
);
const canceled = preview([
  { events: master },
  { events: { ...detached, isCanceled: true } },
]);
assert.deepEqual(
  canceled.map((event) => event.start.toISOString()),
  ["2026-03-28T08:00:00.000Z", "2026-03-30T07:00:00.000Z"],
);
assert.deepEqual(
  preview([{ events: { ...master, isCanceled: true } }, { events: detached }]),
  [],
);
assert.deepEqual(
  preview([
    {
      events: {
        ...master,
        timeModel: undefined,
        recurrence: null,
        isCanceled: true,
      },
    },
  ]),
  [],
);
const movedOut = {
  ...detached,
  start: new Date("2026-06-01T07:00:00Z"),
  end: new Date("2026-06-01T08:00:00Z"),
  timeModel: {
    ...master.timeModel,
    startLocal: "2026-06-01T09:00:00.000",
    endLocal: "2026-06-01T10:00:00.000",
  },
};
assert.deepEqual(preview([{ events: master }, { events: movedOut }]), canceled);
const movedIn = {
  ...detached,
  originalStart: {
    kind: "instant",
    value: "2026-03-01T08:00:00.000Z",
  } satisfies OccurrenceStart,
};
assert.equal(preview([{ events: movedIn }])[0].id, movedIn.id);
const floating = {
  ...master,
  recurrence: null,
  timeModel: {
    kind: "floating",
    startLocal: "2026-03-28T09:00:00.000",
    endLocal: "2026-03-28T10:00:00.000",
  } satisfies EventTimeModel,
};
assert.equal(
  preview([{ events: floating }])[0].start.toISOString(),
  "2026-03-28T09:00:00.000Z",
);
for (const timeModel of [
  undefined,
  { kind: "all-day" } satisfies EventTimeModel,
]) {
  const today = {
    ...master,
    recurrence: null,
    isAllDay: true,
    timeModel,
    start: new Date("2026-03-27T00:00:00Z"),
    end: new Date("2026-03-27T00:00:00Z"),
  };
  assert.equal(
    preview([{ events: today }]).length,
    1,
    "inclusive all-day end remains visible during its date",
  );
  assert.equal(
    preview([{ events: today }], new Date("2026-03-28T00:00:00Z")).length,
    0,
  );
}
for (const event of zoned) {
  assert.deepEqual(Object.keys(event).sort(), [
    "color",
    "end",
    "id",
    "isAllDay",
    "recurrence",
    "start",
    "title",
  ]);
  assert.equal(event.recurrence, null);
}
assert.throws(() =>
  preview([{ events: { ...master, recurrence: "FREQ=HOURLY" } }]),
);
console.log("Invite preview time, cancellation and privacy projection: OK");
