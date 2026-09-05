import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/eventsCache", () => ({
  cacheDeleteEvents: vi.fn(),
  cacheUpsertEvents: vi.fn(),
}));
vi.mock("@/services/notifications", () => ({
  cancelEventNotification: vi.fn(),
  syncScheduledReminders: vi.fn(),
}));

import { useCalendarsStore } from "./useCalendarsStore";
import { useEventsStore } from "./useEventsStore";

const event = {
  revision: 1,
  id: "e1", calendars: ["c1"], title: "Before",
} as any;
const calendar = { id: "c1", name: "Before" } as any;

beforeEach(() => {
  useEventsStore.setState({ events: [event] });
  useCalendarsStore.setState({ calendars: [calendar], activeCals: new Set(["c1"]), soloCalId: null,
  });
});

describe("optimistic stores", () => {
  it("updates an event immediately and rolls back on failure", async () => {
    let reject!: (error: Error) => void;
    const request = new Promise((_, fail) => { reject = fail; });
    const pending = useEventsStore.getState().updateEvent(
      { ...event, title: "After" },
      { updateEvent: () => request,
      } as any);
    expect(useEventsStore.getState().events[0].title).toBe("After");
    reject(new Error("offline"));
    await expect(pending).rejects.toThrow("offline");
    expect(useEventsStore.getState().events[0].title).toBe("Before");
  });

  it("removes a calendar immediately and rolls back on failure", async () => {
    let reject!: (error: Error) => void;
    const request = new Promise((_, fail) => { reject = fail; });
    const pending = useCalendarsStore.getState().removeCalendar(
      calendar,
      { removeCalendar: () => request } as any);
    expect(useCalendarsStore.getState().calendars).toHaveLength(0);
    reject(new Error("offline"));
    await expect(pending).rejects.toThrow("offline");
    expect(useCalendarsStore.getState().calendars).toEqual([calendar]);
  });
});
