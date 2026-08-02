import type { Event } from "@musubi/types";
import { describe, expect, it } from "vitest";
import { seriesEditWrites } from "./recurrence-edit";

const master: Event = {
  calendars: ["work"],
  color: "#123456",
  creatorID: "user-1",
  description: null,
  end: new Date("2026-07-06T10:00:00Z"),
  hasAttendees: false,
  id: "standup",
  isAllDay: false,
  isCanceled: false,
  location: null,
  organizer: "a@b.c",
  originCalendarID: "work",
  recurrence: "FREQ=WEEKLY",
  start: new Date("2026-07-06T09:00:00Z"),
  title: "Standup",
  url: null,
};

/** The third occurrence, as expansion would produce it. */
const occurrence: Event = {
  ...master,
  end: new Date("2026-07-20T10:00:00Z"),
  id: `standup_${new Date("2026-07-20T09:00:00Z").getTime()}`,
  start: new Date("2026-07-20T09:00:00Z"),
};

/** The occurrence as a drag would leave it: two hours later, same content. */
const moved = {
  edited: {
    ...occurrence,
    end: new Date("2026-07-20T12:00:00Z"),
    start: new Date("2026-07-20T11:00:00Z"),
  },
};

describe("seriesEditWrites", () => {
  it("carries edited content into the scope that receives it", () => {
    const edited = {
      ...occurrence,
      end: new Date("2026-07-20T12:00:00Z"),
      location: "Studio B",
      start: new Date("2026-07-20T11:00:00Z"),
      title: "Standup (long)",
    };

    // The series takes the new content but only shifts by the delta.
    const series = seriesEditWrites({
      edited,
      master,
      occurrence,
      scope: "series",
    });
    expect(series.updates[0]).toMatchObject({
      id: master.id,
      location: "Studio B",
      title: "Standup (long)",
    });
    expect(series.updates[0]!.start.toISOString()).toBe(
      "2026-07-06T11:00:00.000Z",
    );

    // The detached copy is the edit itself, cut loose from the rule.
    const one = seriesEditWrites({
      edited,
      master,
      occurrence,
      scope: "occurrence",
    });
    expect(one.creates[0]).toMatchObject({
      location: "Studio B",
      recurrence: null,
      title: "Standup (long)",
    });
    // The series it left keeps its own content, minus this date.
    expect(one.updates[0]!.title).toBe(master.title);
  });

  it("takes a rewritten rule at face value when splitting", () => {
    const { creates } = seriesEditWrites({
      edited: { ...occurrence, recurrence: "FREQ=DAILY" },
      master: { ...master, recurrence: "FREQ=WEEKLY;COUNT=5" },
      occurrence,
      scope: "following",
    });

    // Not the remaining count of a rule the user replaced.
    expect(creates[0]!.recurrence).toBe("FREQ=DAILY");
  });

  it("shifts the whole series by what the occurrence moved", () => {
    const { creates, updates } = seriesEditWrites({
      ...moved,
      master,
      occurrence,
      scope: "series",
    });

    expect(creates).toHaveLength(0);
    // The occurrence moved two hours later, so the master does too — its own
    // date is untouched.
    expect(updates[0]!.start.toISOString()).toBe("2026-07-06T11:00:00.000Z");
    expect(updates[0]!.end.toISOString()).toBe("2026-07-06T12:00:00.000Z");
    expect(updates[0]!.recurrence).toBe("FREQ=WEEKLY");
  });

  it("keeps a resize on the edge that moved", () => {
    const { updates } = seriesEditWrites({
      edited: { ...occurrence, end: new Date("2026-07-20T11:00:00Z") },
      master,
      occurrence,
      scope: "series",
    });

    expect(updates[0]!.start.toISOString()).toBe("2026-07-06T09:00:00.000Z");
    expect(updates[0]!.end.toISOString()).toBe("2026-07-06T11:00:00.000Z");
  });

  it("detaches a single occurrence and excludes it from the series", () => {
    const { creates, updates } = seriesEditWrites({
      ...moved,
      master,
      occurrence,
      scope: "occurrence",
    });

    expect(updates[0]!.recurrence).toContain("EXDATE:20260720T090000Z");
    expect(creates[0]!.recurrence).toBeNull();
    expect(creates[0]!.id).not.toBe(master.id);
    expect(creates[0]!.start.toISOString()).toBe("2026-07-20T11:00:00.000Z");
    expect(creates[0]!.calendars).toEqual(["work"]);
  });

  it("splits the series in two at this occurrence", () => {
    const { creates, updates } = seriesEditWrites({
      ...moved,
      master,
      occurrence,
      scope: "following",
    });

    // The old half stops just before the moved occurrence.
    expect(updates[0]!.recurrence).toBe("FREQ=WEEKLY;UNTIL=20260720T085959Z");
    // The new half carries the rule and starts at the new time.
    expect(creates[0]!.recurrence).toBe("FREQ=WEEKLY");
    expect(creates[0]!.start.toISOString()).toBe("2026-07-20T11:00:00.000Z");
  });

  it("reduces COUNT so a split does not double the occurrences", () => {
    const { creates, updates } = seriesEditWrites({
      ...moved,
      master: { ...master, recurrence: "FREQ=WEEKLY;COUNT=5" },
      occurrence,
      scope: "following",
    });

    expect(updates[0]!.recurrence).toContain("UNTIL=");
    // Two occurrences stay behind (6 and 13 July), so three remain.
    expect(creates[0]!.recurrence).toBe("FREQ=WEEKLY;COUNT=3");
  });

  it("treats a split at the first occurrence as moving the series", () => {
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

    expect(creates).toHaveLength(0);
    expect(updates[0]!.id).toBe(master.id);
    expect(updates[0]!.recurrence).toBe("FREQ=WEEKLY");
  });
});
