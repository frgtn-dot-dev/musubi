import { describe, expect, it } from "vitest";
import { EventSchema } from "@musubi/types";
import type { ICalendarEventBase } from "@musubi/calendar";
import { expandForView } from "./workspace-queries";

const series = {
  ...EventSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    creatorID: "owner",
    organizer: "owner",
    title: "Series",
    color: "red",
    start: "2026-01-01T09:00:00Z",
    end: "2026-01-01T10:00:00Z",
    calendars: ["calendar"],
    isCanceled: false,
    isAllDay: false,
    recurrence: "FREQ=DAILY;COUNT=3",
  }),
  timeModel: {
    kind: "zoned",
    timeZone: "UTC",
    startLocal: "2026-01-01T09:00:00.000",
    endLocal: "2026-01-01T10:00:00.000",
  } satisfies ICalendarEventBase["timeModel"],
};
const exception = {
  ...series,
  id: "00000000-0000-4000-8000-000000000002",
  seriesID: series.id,
  originalStart: {
    kind: "instant",
    value: "2026-01-02T09:00:00.000Z",
  } as const,
  recurrence: null,
  start: new Date("2030-01-01T09:00:00Z"),
  end: new Date("2030-01-01T10:00:00Z"),
  timeModel: {
    ...series.timeModel,
    startLocal: "2030-01-01T09:00:00.000",
    endLocal: "2030-01-01T10:00:00.000",
  },
};
const range = { start: new Date("2026-01-01Z"), end: new Date("2026-01-05Z") };

describe("workspace time expansion", () => {
  it.each(["agenda", "week"] as const)(
    "%s passes cancellation definitions through replacement",
    (view) => {
      const rows = expandForView(
        [series, { ...exception, isCanceled: true }],
        range,
        view,
        "UTC",
      );
      expect(rows.map((row) => row.start.toISOString())).toEqual([
        "2026-01-01T09:00:00.000Z",
        "2026-01-03T09:00:00.000Z",
      ]);
    },
  );
  it("agenda preserves distant exceptions without also showing the original slot", () => {
    const rows = expandForView([series, exception], range, "agenda", "UTC");
    expect(rows.map((row) => row.start.toISOString())).toEqual([
      "2026-01-01T09:00:00.000Z",
      "2026-01-03T09:00:00.000Z",
      "2030-01-01T09:00:00.000Z",
    ]);
    expect(
      expandForView([series, exception], range, "week", "UTC"),
    ).toHaveLength(2);
  });
  it("resolves a distant floating standalone event in the agenda viewer zone", () => {
    const standalone = {
      ...exception,
      seriesID: undefined,
      originalStart: undefined,
      timeModel: {
        kind: "floating" as const,
        startLocal: "2030-01-01T09:00:00.000",
        endLocal: "2030-01-01T10:00:00.000",
      },
    };
    const rows = expandForView(
      [standalone],
      range,
      "agenda",
      "America/New_York",
    );
    expect(rows[0].start.toISOString()).toBe("2030-01-01T14:00:00.000Z");
  });
});
