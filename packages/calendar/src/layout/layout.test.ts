import assert from "node:assert/strict";
import {
  bucketEventsByDay,
  dayKey,
  eventDayKeys,
  getAllDaySpans,
  getDaySegments,
  getMonthGrid,
  getMonthGridRange,
  segmentEventsByDay,
} from "./index";

type TestEvent = {
  end: Date;
  id: string;
  isAllDay: boolean;
  start: Date;
  title: string;
};

function allDayEvent(
  id: string,
  start: string,
  end: string,
): TestEvent {
  return {
    end: new Date(`${end}T00:00:00Z`),
    id,
    isAllDay: true,
    start: new Date(`${start}T00:00:00Z`),
    title: id,
  };
}

function timedEvent(
  id: string,
  start: Date,
  end: Date,
): TestEvent {
  return {
    end,
    id,
    isAllDay: false,
    start,
    title: id,
  };
}

const july = new Date(2026, 6, 26);

assert.deepEqual(
  getMonthGrid(july, "monday")
    .filter((_, index) => index === 0 || index === 41)
    .map(dayKey),
  ["2026-06-29", "2026-08-09"],
  "Monday-first Month must retain its current six-week boundaries",
);

assert.deepEqual(
  getMonthGrid(july, "sunday")
    .filter((_, index) => index === 0 || index === 41)
    .map(dayKey),
  ["2026-06-28", "2026-08-08"],
  "Sunday-first Month must retain its current six-week boundaries",
);

const paddedRange = getMonthGridRange(july, "monday", 1);
assert.equal(
  paddedRange.start.getFullYear(),
  2026,
  "The padded range must stay in the expected year",
);
assert.equal(
  paddedRange.start.getMonth(),
  5,
  "The padded range must start in June",
);
assert.equal(paddedRange.start.getDate(), 28);
assert.equal(paddedRange.endExclusive.getMonth(), 7);
assert.equal(paddedRange.endExclusive.getDate(), 11);

const retreat = allDayEvent(
  "retreat",
  "2026-07-17",
  "2026-07-22",
);
assert.deepEqual(eventDayKeys(retreat), [
  "2026-07-17",
  "2026-07-18",
  "2026-07-19",
  "2026-07-20",
  "2026-07-21",
  "2026-07-22",
]);

const midnightTimed = timedEvent(
  "midnight",
  new Date(2026, 6, 20, 23, 0),
  new Date(2026, 6, 21, 0, 0),
);
assert.deepEqual(
  eventDayKeys(midnightTimed),
  ["2026-07-20"],
  "A timed event ending at midnight must not bleed into the next day",
);

const call = timedEvent(
  "call",
  new Date(2026, 6, 17, 9, 0),
  new Date(2026, 6, 17, 10, 0),
);
assert.deepEqual(
  bucketEventsByDay([call, retreat]).get("2026-07-17"),
  [retreat, call],
  "All-day events must remain ahead of timed events in day buckets",
);

const segmented = segmentEventsByDay(
  [retreat],
  new Date(2026, 6, 18),
  new Date(2026, 6, 21),
);
assert.deepEqual([...segmented.keys()], [
  "2026-07-18",
  "2026-07-19",
  "2026-07-20",
]);
assert.deepEqual(
  segmented.get("2026-07-19")?.[0],
  {
    continuesAfter: true,
    continuesBefore: true,
    event: retreat,
  },
);

const week = Array.from(
  { length: 7 },
  (_, index) => new Date(2026, 6, 13 + index),
);
const overlappingHoliday = allDayEvent(
  "holiday",
  "2026-07-16",
  "2026-07-18",
);
assert.deepEqual(
  getAllDaySpans([retreat, overlappingHoliday], week).map((span) => ({
    endCol: span.endCol,
    id: span.event.id,
    lane: span.lane,
    startCol: span.startCol,
  })),
  [
    { endCol: 5, id: "holiday", lane: 0, startCol: 3 },
    { endCol: 6, id: "retreat", lane: 1, startCol: 4 },
  ],
  "Overlapping all-day spans must occupy separate stable lanes",
);

const overlapDay = new Date(2026, 6, 20);
const long = timedEvent(
  "long",
  new Date(2026, 6, 20, 9, 0),
  new Date(2026, 6, 20, 12, 0),
);
const early = timedEvent(
  "early",
  new Date(2026, 6, 20, 9, 30),
  new Date(2026, 6, 20, 10, 30),
);
const late = timedEvent(
  "late",
  new Date(2026, 6, 20, 10, 30),
  new Date(2026, 6, 20, 13, 0),
);
assert.deepEqual(
  getDaySegments([late, early, long], overlapDay).map((segment) => ({
    col: segment.col,
    cols: segment.cols,
    id: segment.event.id,
  })),
  [
    { col: 0, cols: 2, id: "long" },
    { col: 1, cols: 2, id: "early" },
    { col: 1, cols: 2, id: "late" },
  ],
  "Transitive overlaps must share one two-column cluster",
);

console.log("calendar layout golden self-check: OK");
