import type { Event } from "@musubi/types";
import { describe, expect, it } from "vitest";
import type { PollCalendar } from "~/api/contracts";
import { calendarLaneSpans, visibleLaneLimit } from "./all-day-lanes";
import type { PollCalendarItem } from "./components/PollCalendarChip";

function days(from: string, count = 7) {
  const start = new Date(`${from}T12:00:00`);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function pollItems(id: string, dates: string[]): PollCalendarItem[] {
  const poll: PollCalendar = {
    approximateStartTime: null,
    chosenSlotID: null,
    closed: false,
    closedAt: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    days: [],
    deadline: null,
    durationMinutes: 1440,
    id,
    respondents: 0,
    role: "participant",
    title: id,
    token: id,
    url: `https://musubi.test/s/${id}`,
  };
  const items = dates.map((date, index) => ({
    date,
    day: {
      date,
      end: new Date(`${date}T23:59:00Z`),
      id: `${id}-${index}`,
      ifNeeded: 0,
      no: 0,
      start: new Date(`${date}T00:00:00Z`),
      yes: 0,
    },
    poll,
  }));
  poll.days = items.map((item) => item.day);
  return items;
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
  it("keeps a long poll in one lane while later items reuse space above it", () => {
    const items = [
      ...pollItems("short", ["2026-08-10", "2026-08-11"]),
      ...pollItems("long", [
        "2026-08-11",
        "2026-08-12",
        "2026-08-13",
        "2026-08-14",
      ]),
      ...pollItems("later", ["2026-08-12"]),
    ];
    const spans = calendarLaneSpans([], items, days("2026-08-10"));
    expect(
      spans.map((span) => ({ id: span.id, lane: span.lane })),
    ).toEqual([
      { id: "poll:short:2026-08-10", lane: 0 },
      { id: "poll:long:2026-08-11", lane: 1 },
      { id: "poll:later:2026-08-12", lane: 0 },
    ]);
  });

  it("keeps a long all-day event in one lane while space above is reused", () => {
    const spans = calendarLaneSpans(
      [
        allDayEvent("short", "2026-08-10", "2026-08-11"),
        allDayEvent("long", "2026-08-11", "2026-08-14"),
        allDayEvent("later", "2026-08-12", "2026-08-12"),
      ],
      [],
      days("2026-08-10"),
    );
    expect(
      spans.map((span) => ({ id: span.id, lane: span.lane })),
    ).toEqual([
      { id: "event:short", lane: 0 },
      { id: "event:long", lane: 1 },
      { id: "event:later", lane: 0 },
    ]);
  });

  it("puts the longer block first, then uses event-before-poll as a tie-break", () => {
    const week = days("2026-08-10");
    const longPoll = pollItems("poll", [
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
    ]);
    const event = allDayEvent("event", "2026-08-10", "2026-08-11");
    const spans = calendarLaneSpans([event], longPoll, week);
    expect(spans.find((span) => span.kind === "poll")?.lane).toBe(0);
    expect(spans.find((span) => span.kind === "event")?.lane).toBe(1);

    const equalPoll = pollItems("equal-poll", ["2026-08-10", "2026-08-11"]);
    const equalEvent = allDayEvent("equal-event", "2026-08-10", "2026-08-11");
    const equal = calendarLaneSpans([equalEvent], equalPoll, week);
    expect(equal.find((span) => span.kind === "event")?.lane).toBe(0);
    expect(equal.find((span) => span.kind === "poll")?.lane).toBe(1);
  });

  it("orders by full duration when weekends are hidden", () => {
    const workweek = days("2026-08-10", 5);
    const weekPoll = pollItems("week-poll", [
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
    const workEvent = allDayEvent("work-event", "2026-08-10", "2026-08-14");
    const spans = calendarLaneSpans([workEvent], weekPoll, workweek);
    expect(spans.find((span) => span.kind === "poll")?.lane).toBe(0);
    expect(spans.find((span) => span.kind === "event")?.lane).toBe(1);
  });

  it("keeps timed Month events on their start day", () => {
    const overnight = {
      ...allDayEvent("overnight", "2026-08-10", "2026-08-11"),
      end: new Date(2026, 7, 11, 1),
      isAllDay: false,
      start: new Date(2026, 7, 10, 23),
    };
    const [span] = calendarLaneSpans(
      [overnight],
      [],
      days("2026-08-10"),
      true,
    );
    expect(span).toMatchObject({ endCol: 0, startCol: 0 });
  });

  it("splits disconnected poll dates and repacks at a week boundary", () => {
    const items = pollItems("poll", ["2026-08-10", "2026-08-12"]);
    expect(calendarLaneSpans([], items, days("2026-08-10"))).toHaveLength(2);

    const long = allDayEvent("long", "2026-08-14", "2026-08-18");
    const blocker = allDayEvent("blocker", "2026-08-13", "2026-08-16");
    const firstWeek = calendarLaneSpans(
      [long, blocker],
      [],
      days("2026-08-10"),
    );
    const secondWeek = calendarLaneSpans(
      [long, blocker],
      [],
      days("2026-08-17"),
    );
    expect(firstWeek.find((span) => span.id === "event:long")?.lane).toBe(1);
    expect(secondWeek.find((span) => span.id === "event:long")?.lane).toBe(0);
  });
});
