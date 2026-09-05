import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/eventsCache", () => ({
  cacheDeleteEvents: vi.fn().mockResolvedValue(undefined),
  cacheUpsertEvents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/useRefreshData", () => ({ refreshEventData: vi.fn().mockResolvedValue(undefined) }));
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
    } else { finish({ ...event, revision: 2 }); await expect(pending).rejects.toThrow("Saved locally"); }
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

for (const reconciliation of ["other-removal", "full-unchanged-target"] as const) {
  for (const action of ["removeEvent", "updateEvent", "addEvent", "linkEvent", "forkEvent"] as const) {
    it(`applies B ${action} including cache/reminders after ${reconciliation} of A`, async () => {
      const { EventSchema } = await import("@musubi/types");
      const { cacheDeleteEvents, cacheUpsertEvents } = await import("@/services/eventsCache");
      const { cancelEventNotification, syncScheduledReminders } = await import("@/services/notifications");
      const b = EventSchema.parse({ ...event, id: "b", creatorID: "owner", organizer: "owner", color: "red", isAllDay: false, isCanceled: false, start: new Date(), end: new Date(), originCalendarID: "c1" });
      useEventsStore.setState({ events: [event, b] });
      let finish!: (result: any) => void;
      const request = () => new Promise(resolve => { finish = resolve; });
      const api = { removeEvent: request, updateEvent: request, createEvent: request, linkEvent: request, forkEvent: request } as any;
      const pending = action === "linkEvent" || action === "forkEvent"
        ? useEventsStore.getState()[action](b, "c2", api)
        : useEventsStore.getState()[action](b, api);
      if (reconciliation === "other-removal") await useEventsStore.getState().localRemoveEvent({ ...event, revision: 3 });
      else useEventsStore.getState().loadEvents(useEventsStore.getState().events.filter(e => e.id !== event.id));
      vi.clearAllMocks();
      const result = { ...b, id: reconciliation === "other-removal" && (action === "forkEvent" || action === "addEvent") ? "server-created" : b.id, title: "Confirmed", revision: 2 };
      finish(action === "removeEvent" ? { id: b.id, removed: true, calendars: [], revision: 2 } : result);
      await pending;
      if (action === "removeEvent") {
        expect(useEventsStore.getState().events).not.toContainEqual(b);
        expect(cacheDeleteEvents).toHaveBeenCalledWith([b.id]);
        expect(cancelEventNotification).toHaveBeenCalledWith(b.id);
      } else {
        expect(useEventsStore.getState().events).toContainEqual(result);
        expect(cacheUpsertEvents).toHaveBeenCalledWith([result]);
        expect(syncScheduledReminders).toHaveBeenCalledWith([result], { onlyEventIDs: [result.id] });
        if (action === "addEvent" && result.id !== b.id) expect(useEventsStore.getState().events.some(e => e.id === b.id)).toBe(false);
      }
    });
  }
}

it("source removal cannot fence an independent fork, while a known newer removal of the returned ID does", async () => {
  const { EventSchema } = await import("@musubi/types");
  const source = EventSchema.parse({ ...event, creatorID: "owner", organizer: "owner", color: "red", isAllDay: false, isCanceled: false, start: new Date(), end: new Date() });
  for (const removedID of [source.id, "fork"]) {
    useEventsStore.setState({ events: [source] });
    let finish!: (value: any) => void;
    const pending = useEventsStore.getState().forkEvent(source, "c2", { forkEvent: () => new Promise(resolve => { finish = resolve; }) } as any);
    await useEventsStore.getState().localRemoveEvent({ ...source, id: removedID, revision: 3 });
    finish({ ...source, id: "fork", revision: 2 });
    if (removedID === "fork") {
      await expect(pending).rejects.toThrow("Saved locally");
      expect(useEventsStore.getState().events.some(e => e.id === "fork")).toBe(false);
    } else {
      await pending;
      expect(useEventsStore.getState().events.find(e => e.id === "fork")?.revision).toBe(2);
    }
  }
});

for (const outcome of ["success", "current-error"] as const) {
  for (const receiptRevision of [2, 4]) {
    it(`${outcome} revision ${receiptRevision} is ordered against target removal 3; fresh authoritative revival still works`, async () => {
      const { EventSchema, EventMutationError } = await import("@musubi/types");
      const target = EventSchema.parse({ ...event, creatorID: "owner", organizer: "owner", color: "red", isAllDay: false, isCanceled: false, start: new Date(), end: new Date() });
      useEventsStore.setState({ events: [target] });
      let finish!: (value: any) => void;
      let fail!: (error: Error) => void;
      const pending = useEventsStore.getState().updateEvent(target, { updateEvent: () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }) } as any);
      await useEventsStore.getState().localRemoveEvent({ ...target, revision: 3 });
      if (outcome === "success") finish({ ...target, revision: receiptRevision });
      else fail(new EventMutationError("Saved locally", true, { ...target, revision: receiptRevision }));
      if (outcome === "current-error" || receiptRevision < 3) await expect(pending).rejects.toThrow("Saved locally");
      else await pending;
      expect(useEventsStore.getState().events.length).toBe(receiptRevision > 3 ? 1 : 0);
      await useEventsStore.getState().localUpdateEvent({ ...target, revision: 5 });
      await useEventsStore.getState().localRemoveEvent({ ...target, revision: 4 });
      expect(useEventsStore.getState().events[0].revision).toBe(5);
    });
  }
}

it("account/server reset fences even a server-assigned created identity", async () => {
  let finish!: (value: any) => void;
  const pending = useEventsStore.getState().addEvent(event, { createEvent: () => new Promise(resolve => { finish = resolve; }) } as any);
  useEventsStore.getState().resetEvents();
  finish({ ...event, id: "server-created", revision: 2 });
  await expect(pending).rejects.toThrow("Saved locally");
  expect(useEventsStore.getState().events).toEqual([]);
});
