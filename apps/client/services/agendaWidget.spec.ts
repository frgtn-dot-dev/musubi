import { afterEach, expect, it, vi } from "vitest";
import type { CachedEvent } from "./eventsCache";

const fixture = vi.hoisted(() => ({
  events: [] as CachedEvent[],
  snapshot: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("@/modules/musubi-agenda-widget", () => ({
  default: {
    updateSnapshot: fixture.snapshot,
  },
}));
vi.mock("@/lib/eventColor", () => ({ eventColor: () => "red" }));
vi.mock("@/store/useEventsStore", () => ({
  useEventsStore: {
    getState: () => ({ events: fixture.events }),
    subscribe: () => () => {},
  },
}));
vi.mock("@/store/useCalendarsStore", () => ({
  useCalendarsStore: {
    getState: () => ({ calendars: [{ id: "calendar", name: "Home" }] }),
    subscribe: () => () => {},
  },
}));
vi.mock("@/store/useSettingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ timeFormat: "24h", weekStartsOn: "monday" }),
    subscribe: () => () => {},
  },
}));
const { startAgendaWidgetSync } = await import("./agendaWidget");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  fixture.snapshot.mockReset();
});

it.each(["UTC", "Europe/Prague", "America/New_York"])(
  "keeps inclusive all-day dates and exclusive timed midnight in %s",
  async (timezone) => {
    vi.stubEnv("TZ", timezone);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(timezone);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 8, 15));
    const base = {
      creatorID: "owner",
      organizer: "owner",
      title: "Event",
      color: "red",
      calendars: ["calendar"],
      isCanceled: false,
      hasAttendees: false,
      isAllDay: true,
      start: new Date("2026-09-08T00:00:00Z"),
      end: new Date("2026-09-08T00:00:00Z"),
    };
    fixture.events = [
      { ...base, id: "today" },
      {
        ...base,
        id: "00000000-0000-4000-8000-000000000001",
        timeModel: { kind: "all-day" },
        start: new Date("2026-09-07T00:00:00Z"),
      },
      {
        ...base,
        id: "past",
        start: new Date("2026-09-07T00:00:00Z"),
        end: new Date("2026-09-07T00:00:00Z"),
      },
      {
        ...base,
        id: "timed",
        isAllDay: false,
        start: new Date(2026, 8, 9, 23),
        end: new Date(2026, 8, 10),
      },
    ];
    const stop = startAgendaWidgetSync();
    try {
      await vi.advanceTimersByTimeAsync(120);
      expect(fixture.snapshot).toHaveBeenCalledTimes(1);
      const snapshot = JSON.parse(fixture.snapshot.mock.calls[0][0]);
      const ids = snapshot.events.map((event: { id: string }) => event.id);
      expect(ids).toContain("today");
      expect(ids).toContain(fixture.events[1].id);
      expect(ids).not.toContain("past");
      const days = new Map<
        string,
        { events: { title: string; id: string; endKey: string }[] }
      >(snapshot.calendarDays.map((day: { date: string }) => [day.date, day]));
      for (const date of ["2026-09-07", "2026-09-08"]) {
        const chip = days
          .get(date)
          ?.events.find((event) => event.id.startsWith(fixture.events[1].id));
        expect(chip?.endKey).toBe("2026-09-08");
      }
      expect(
        days
          .get("2026-09-09")
          ?.events.some((event) => event.id.startsWith("timed:")),
      ).toBe(true);
      expect(
        days
          .get("2026-09-10")
          ?.events.some((event) => event.id.startsWith("timed:")) ?? false,
      ).toBe(false);
    } finally {
      stop();
    }
  },
);
