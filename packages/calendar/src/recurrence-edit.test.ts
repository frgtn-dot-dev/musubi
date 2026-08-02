import assert from "node:assert/strict";
import { seriesEditWrites } from "./recurrence-edit";

type TestEvent = {
  end: Date;
  id: string;
  location?: string;
  recurrence?: string | null;
  start: Date;
  title: string;
};

const master: TestEvent = {
  end: new Date("2026-07-06T10:00:00Z"),
  id: "standup",
  recurrence: "FREQ=WEEKLY",
  start: new Date("2026-07-06T09:00:00Z"),
  title: "Standup",
};

/** The third occurrence, as expansion would produce it. */
const occurrence: TestEvent = {
  ...master,
  end: new Date("2026-07-20T10:00:00Z"),
  id: `standup_${new Date("2026-07-20T09:00:00Z").getTime()}`,
  start: new Date("2026-07-20T09:00:00Z"),
};

/** The occurrence as a drag would leave it: two hours later, same content. */
const moved: TestEvent = {
  ...occurrence,
  end: new Date("2026-07-20T12:00:00Z"),
  start: new Date("2026-07-20T11:00:00Z"),
};

// The series takes the new content but only shifts by what the occurrence
// moved — setting the master to the occurrence's own date would drag the whole
// series onto that one day.
{
  const { creates, updates } = seriesEditWrites({
    edited: moved,
    master,
    occurrence,
    scope: "series",
  });

  assert.equal(creates.length, 0);
  assert.equal(updates[0]!.start.toISOString(), "2026-07-06T11:00:00.000Z");
  assert.equal(updates[0]!.end.toISOString(), "2026-07-06T12:00:00.000Z");
  assert.equal(updates[0]!.recurrence, "FREQ=WEEKLY");
  assert.equal(updates[0]!.id, master.id);
}

// A resize moves only the edge that moved.
{
  const { updates } = seriesEditWrites({
    edited: { ...occurrence, end: new Date("2026-07-20T11:00:00Z") },
    master,
    occurrence,
    scope: "series",
  });

  assert.equal(updates[0]!.start.toISOString(), "2026-07-06T09:00:00.000Z");
  assert.equal(updates[0]!.end.toISOString(), "2026-07-06T11:00:00.000Z");
}

// Edited content reaches the scope that receives it, and no further.
{
  const edited = { ...moved, location: "Studio B", title: "Standup (long)" };

  const series = seriesEditWrites({ edited, master, occurrence, scope: "series" });
  assert.equal(series.updates[0]!.title, "Standup (long)");
  assert.equal(series.updates[0]!.location, "Studio B");

  const one = seriesEditWrites({ edited, master, occurrence, scope: "occurrence" });
  assert.equal(one.creates[0]!.title, "Standup (long)");
  assert.equal(one.creates[0]!.recurrence, null);
  assert.notEqual(one.creates[0]!.id, master.id);
  // The series it left keeps its own content, minus this date.
  assert.equal(one.updates[0]!.title, master.title);
  assert.match(one.updates[0]!.recurrence!, /EXDATE:20260720T090000Z/);
}

// Splitting ends the old half and starts a new one at the edited time.
{
  const { creates, updates } = seriesEditWrites({
    edited: moved,
    master,
    occurrence,
    scope: "following",
  });

  assert.equal(updates[0]!.recurrence, "FREQ=WEEKLY;UNTIL=20260720T085959Z");
  assert.equal(creates[0]!.recurrence, "FREQ=WEEKLY");
  assert.equal(creates[0]!.start.toISOString(), "2026-07-20T11:00:00.000Z");
}

// COUNT is reduced, or both halves would claim the full run.
{
  const { creates } = seriesEditWrites({
    edited: moved,
    master: { ...master, recurrence: "FREQ=WEEKLY;COUNT=5" },
    occurrence,
    scope: "following",
  });

  // Two occurrences stay behind (6 and 13 July), so three remain.
  assert.equal(creates[0]!.recurrence, "FREQ=WEEKLY;COUNT=3");
}

// A rule the user rewrote is taken at face value, not recomputed.
{
  const { creates } = seriesEditWrites({
    edited: { ...occurrence, recurrence: "FREQ=DAILY" },
    master: { ...master, recurrence: "FREQ=WEEKLY;COUNT=5" },
    occurrence,
    scope: "following",
  });

  assert.equal(creates[0]!.recurrence, "FREQ=DAILY");
}

// Nothing precedes the first occurrence, so splitting there moves the series.
{
  const { creates, updates } = seriesEditWrites({
    edited: {
      ...master,
      end: new Date("2026-07-06T12:00:00Z"),
      start: new Date("2026-07-06T11:00:00Z"),
    },
    master,
    occurrence: master,
    scope: "following",
  });

  assert.equal(creates.length, 0);
  assert.equal(updates[0]!.id, master.id);
  assert.equal(updates[0]!.recurrence, "FREQ=WEEKLY");
}

console.log("recurrence edit scope self-check: OK");
