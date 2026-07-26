import type { Event } from "@musubi/types";
import { describe, expect, it } from "vitest";
import {
  AGENDA_WINDOW_DAYS,
  getAgendaDays,
  getAgendaEventsByDay,
  getAgendaRange,
  getAgendaRangeLabel,
} from "./agenda-math";
import { parseDateKey } from "./calendar-math";
import { toDateKey } from "./date-key";

function event(
  id: string,
  start: string,
  end: string,
  isAllDay = false,
): Event {
  return {
    calendars: ["personal"],
    color: "#b3492f",
    creatorID: "alex",
    description: null,
    end: new Date(end),
    hasAttendees: false,
    id,
    isAllDay,
    isCanceled: false,
    location: null,
    organizer: "alex@example.com",
    originCalendarID: "personal",
    recurrence: null,
    start: new Date(start),
    title: id,
    url: null,
  };
}

describe("agenda math", () => {
  it("builds a bounded 28-day window from the selected date", () => {
    const range = getAgendaRange(parseDateKey("2026-07-26"));
    const days = getAgendaDays(range.start, range.end);

    expect(days).toHaveLength(AGENDA_WINDOW_DAYS);
    expect(toDateKey(days[0]!)).toBe("2026-07-26");
    expect(toDateKey(days[27]!)).toBe("2026-08-22");
    expect(toDateKey(range.end)).toBe("2026-08-23");
  });

  it("formats same-month, cross-month and cross-year ranges", () => {
    expect(
      getAgendaRangeLabel(
        parseDateKey("2026-07-01"),
        parseDateKey("2026-07-29"),
      ),
    ).toBe("Jul 1 – 28, 2026");
    expect(
      getAgendaRangeLabel(
        parseDateKey("2026-07-26"),
        parseDateKey("2026-08-23"),
      ),
    ).toBe("Jul 26 – Aug 22, 2026");
    expect(
      getAgendaRangeLabel(
        parseDateKey("2026-12-20"),
        parseDateKey("2027-01-17"),
      ),
    ).toBe("Dec 20, 2026 – Jan 16, 2027");
  });

  it("groups only event starts inside the visible window", () => {
    const start = parseDateKey("2026-07-26");
    const end = parseDateKey("2026-08-23");
    const buckets = getAgendaEventsByDay(
      [
        event(
          "before",
          "2026-07-25T10:00:00",
          "2026-07-25T11:00:00",
        ),
        event(
          "timed",
          "2026-07-27T11:00:00",
          "2026-07-27T12:00:00",
        ),
        event(
          "all-day",
          "2026-07-27T00:00:00Z",
          "2026-07-29T00:00:00Z",
          true,
        ),
        event(
          "after",
          "2026-08-23T10:00:00",
          "2026-08-23T11:00:00",
        ),
      ],
      start,
      end,
    );

    expect([...buckets.keys()]).toEqual(["2026-07-27"]);
    expect(buckets.get("2026-07-27")?.map((item) => item.id)).toEqual([
      "all-day",
      "timed",
    ]);
  });
});
