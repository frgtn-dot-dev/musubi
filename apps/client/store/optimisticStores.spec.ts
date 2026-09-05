import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/eventsCache", () => ({
  cacheDeleteEvents: vi.fn().mockResolvedValue(undefined),
  cacheUpsertEvents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/notifications", () => ({
  cancelEventNotification: vi.fn().mockResolvedValue(undefined),
  syncScheduledReminders: vi.fn().mockResolvedValue(undefined),
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

it("never rolls back a committed failure without a readable current row", async () => {
  const { EventMutationError } = await import("@musubi/types");
  for (const action of ["updateEvent", "addEvent"] as const) {
    const error = new EventMutationError("Saved locally", true);
    await expect(useEventsStore.getState()[action]({ ...event, title: "Committed" }, {
      updateEvent: async () => { throw error; }, createEvent: async () => { throw error; },
    } as any)).rejects.toBe(error);
    expect(useEventsStore.getState().events[0].title).toBe("Committed");
  }
});

for (const removal of ["revision", "full", "calendar"] as const) {
  for (const failure of [false, true]) it(`does not resurrect on delayed ${failure ? "committed error" : "success"} after ${removal} removal`, async () => {
    const { EventMutationError } = await import("@musubi/types");
    const { cacheUpsertEvents } = await import("@/services/eventsCache");
    const { syncScheduledReminders } = await import("@/services/notifications");
    let finish!: (value: any) => void;
    let reject!: (error: Error) => void;
    const pending = useEventsStore.getState().updateEvent({ ...event, title: "Draft" }, {
      updateEvent: () => new Promise((resolve, fail) => { finish = resolve; reject = fail; }),
    } as any);
    if (removal === "revision") await useEventsStore.getState().localRemoveEvent({ ...event, revision: 3 });
    else if (removal === "full") useEventsStore.getState().loadEvents([]);
    else await useEventsStore.getState().localRemoveCalendarEvents("c1");
    vi.mocked(cacheUpsertEvents).mockClear();
    vi.mocked(syncScheduledReminders).mockClear();
    if (failure) {
      reject(new EventMutationError("Saved locally", true, { ...event, revision: 2 }));
      await expect(pending).rejects.toThrow("Saved locally");
    } else { finish({ ...event, revision: 2 }); await pending; }
    expect(useEventsStore.getState().events).toEqual([]);
    expect(cacheUpsertEvents).not.toHaveBeenCalled();
    expect(syncScheduledReminders).not.toHaveBeenCalled();
  });
}

it("does not optimistically recreate a draft already removed before Save", async () => {
  useEventsStore.getState().loadEvents([]);
  await expect(useEventsStore.getState().updateEvent(event, {
    updateEvent: async () => { throw new Error("access lost"); },
  } as any)).rejects.toThrow("access lost");
  expect(useEventsStore.getState().events).toEqual([]);
});
