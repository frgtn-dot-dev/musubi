import type { Event } from "@musubi/types";
import { describe, expect, it } from "vitest";
import { calendarLaneSpans, visibleLaneLimit } from "./all-day-lanes";

function days(from: string, count = 7) {
  const start = new Date(`${from}T12:00:00`);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function allDayEvent(id: string, start: string, end: string): Event {
  return {
    calendars: ["calendar"],
    color: "#365a92",
    creatorID: "user",
    end: new Date(`${end}T00:00:00Z`),
    hasAttendees: false,
    id,
    isAllDay: true,
    isCanceled: false,
    organizer: "user@example.test",
    originCalendarID: "calendar",
    start: new Date(`${start}T00:00:00Z`),
    title: id,
  };
}

describe("calendar lane spans", () => {
  it("reserves the final visible row for +N without compacting lanes", () => {
    expect(visibleLaneLimit(3, 3)).toBe(3);
    expect(visibleLaneLimit(4, 3)).toBe(2);
  });
  it("keeps a long all-day event in one lane while space above is reused", () => {
    const spans = calendarLaneSpans(
      [
        allDayEvent("short", "2026-08-10", "2026-08-11"),
        allDayEvent("long", "2026-08-11", "2026-08-14"),
        allDayEvent("later", "2026-08-12", "2026-08-12"),
      ],
      days("2026-08-10"),
    );
    expect(spans.map((span) => ({ id: span.id, lane: span.lane }))).toEqual([
      { id: "event:short", lane: 0 },
      { id: "event:long", lane: 1 },
      { id: "event:later", lane: 0 },
    ]);
  });

  it("keeps timed Month events on their start day", () => {
    const overnight = {
      ...allDayEvent("overnight", "2026-08-10", "2026-08-11"),
      end: new Date(2026, 7, 11, 1),
      isAllDay: false,
      start: new Date(2026, 7, 10, 23),
    };
    const [span] = calendarLaneSpans([overnight], days("2026-08-10"), true);
    expect(span).toMatchObject({ endCol: 0, startCol: 0 });
  });

  it("repacks at a week boundary", () => {
    const long = allDayEvent("long", "2026-08-14", "2026-08-18");
    const blocker = allDayEvent("blocker", "2026-08-13", "2026-08-16");
    const firstWeek = calendarLaneSpans([long, blocker], days("2026-08-10"));
    const secondWeek = calendarLaneSpans([long, blocker], days("2026-08-17"));
    expect(firstWeek.find((span) => span.id === "event:long")?.lane).toBe(1);
    expect(secondWeek.find((span) => span.id === "event:long")?.lane).toBe(0);
  });
});
