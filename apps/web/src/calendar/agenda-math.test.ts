import type { Event } from "@musubi/types";
import { describe, expect, it } from "vitest";
import {
  AGENDA_GROUP_PAGE,
  AGENDA_RECURRENCE_HORIZON_YEARS,
  freeDaysBetween,
  getAgendaGroups,
  getAgendaLabel,
  getAgendaRecurrenceEnd,
  getAgendaStart,
  relativeDayName,
} from "./agenda-math";
import { parseDateKey } from "./calendar-math";

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
  it("starts at the current instant for today and midnight for another date", () => {
    const now = new Date("2026-07-26T15:30:00");

    expect(getAgendaStart(parseDateKey("2026-07-26"), now)).toEqual(now);
    expect(
      getAgendaStart(parseDateKey("2026-07-27"), now).getHours(),
    ).toBe(0);
  });

  it("bounds recurring expansion to the same two-year horizon as mobile", () => {
    const start = parseDateKey("2026-07-26");
    const end = getAgendaRecurrenceEnd(start);

    expect(AGENDA_RECURRENCE_HORIZON_YEARS).toBe(2);
    expect(end.getFullYear()).toBe(2028);
    expect(end.getMonth()).toBe(6);
    expect(end.getDate()).toBe(26);
  });

  it("groups only future event dates and keeps all-day events for today", () => {
    const anchor = parseDateKey("2026-07-26");
    const now = new Date("2026-07-26T15:30:00");
    const groups = getAgendaGroups(
      [
        event(
          "past",
          "2026-07-26T14:00:00",
          "2026-07-26T15:00:00",
        ),
        event(
          "today-later",
          "2026-07-26T16:00:00",
          "2026-07-26T17:00:00",
        ),
        event(
          "all-day",
          "2026-07-26T00:00:00Z",
          "2026-07-26T00:00:00Z",
          true,
        ),
        event(
          "tomorrow",
          "2026-07-27T09:00:00",
          "2026-07-27T10:00:00",
        ),
      ],
      anchor,
      now,
    );

    expect(groups.map((group) => group.key)).toEqual([
      "2026-07-26",
      "2026-07-27",
    ]);
    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      "all-day",
      "today-later",
    ]);
  });

  it("keeps distant one-off events and formats the visible anchor", () => {
    const anchor = parseDateKey("2026-07-26");
    const groups = getAgendaGroups(
      [
        event(
          "distant",
          "2030-01-01T10:00:00",
          "2030-01-01T11:00:00",
        ),
      ],
      anchor,
      new Date("2026-07-26T15:30:00"),
    );

    expect(groups[0]?.items[0]?.id).toBe("distant");
    expect(getAgendaLabel(anchor)).toBe("From Jul 26, 2026");
    expect(AGENDA_GROUP_PAGE).toBe(14);
  });

  it("names only the two days a reader already knows", () => {
    const now = new Date("2026-07-31T09:00:00");
    expect(relativeDayName(new Date("2026-07-31T23:59:00"), now)).toBe(
      "Today",
    );
    expect(relativeDayName(new Date("2026-08-01T00:01:00"), now)).toBe(
      "Tomorrow",
    );
    expect(relativeDayName(new Date("2026-08-02T09:00:00"), now)).toBe(
      undefined,
    );
    expect(relativeDayName(new Date("2026-07-30T09:00:00"), now)).toBe(
      undefined,
    );
  });

  it("counts the empty days between two groups, ignoring the time of day", () => {
    expect(
      freeDaysBetween(
        new Date("2026-07-27T23:00:00"),
        new Date("2026-08-03T01:00:00"),
      ),
    ).toBe(6);
    // Neighbouring and same days have nothing free between them.
    expect(
      freeDaysBetween(
        new Date("2026-07-27T01:00:00"),
        new Date("2026-07-28T23:00:00"),
      ),
    ).toBe(0);
    expect(
      freeDaysBetween(
        new Date("2026-07-27T01:00:00"),
        new Date("2026-07-27T23:00:00"),
      ),
    ).toBe(0);
  });

  it("counts free days across a spring-forward boundary", () => {
    // 23-hour day: a plain millisecond division would round this to 5.
    expect(
      freeDaysBetween(
        new Date("2026-03-27T12:00:00"),
        new Date("2026-04-03T12:00:00"),
      ),
    ).toBe(6);
  });
});
