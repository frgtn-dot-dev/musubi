import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/eventsCache", () => ({ cacheDeleteEvents: vi.fn().mockResolvedValue(undefined), cacheUpsertEvents: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/notifications", () => ({ cancelEventNotification: vi.fn().mockResolvedValue(undefined), syncScheduledReminders: vi.fn() }));
import { useEditComposerStore, useEventDetailStore, resetEventModalSnapshots } from "./useEventDetailStore";
import { useEventsStore } from "./useEventsStore";
import { useCalendarsStore } from "./useCalendarsStore";
describe.each(["google", "microsoft", "caldav"])("%s confirmed privacy retirement", provider => {
const source = { id: "source", provider, role: "owner" } as any;
const event = { creatorID: "owner", organizer: "owner", color: "red", start: new Date(), end: new Date(), isAllDay: false, isCanceled: false, id: "event", revision: 2, originCalendarID: "source", calendars: ["source"], title: "Private" } as any;
beforeEach(() => { useEventsStore.getState().resetEvents(); useCalendarsStore.getState().loadCalendars([source]); });
it("only confirmed reconciliation retires a prior Google row, never initial cache loads", () => {
  useEventsStore.getState().loadEvents([], { reconciled: true });
  expect(useEventsStore.getState().retiredGoogleEventIDs.size).toBe(0);
  useEventsStore.getState().loadEvents([event]);
  useEventsStore.getState().loadEvents([]);
  expect(useEventsStore.getState().retiredGoogleEventIDs.size).toBe(0);
  useEventsStore.getState().loadEvents([], { reconciled: true });
  expect(useEventsStore.getState().retiredGoogleEventIDs.has(event.id)).toBe(true);
  useEventsStore.getState().resetEvents();
  useEventsStore.getState().loadEvents([], { reconciled: true });
  expect(useEventsStore.getState().retiredGoogleEventIDs.size).toBe(0);
});
it("remembers a removed Google origin even when a shared survivor remains", () => {
  useEventsStore.getState().loadEvents([event]);
  useCalendarsStore.getState().loadCalendars([{ id: "share" } as any]);
  useEventsStore.getState().loadEvents([{ ...event, originCalendarID: null, calendars: ["share"] }], { reconciled: true });
  expect(useEventsStore.getState().retiredGoogleEventIDs.has(event.id)).toBe(true);
});
it("confirmed SSE source removal retires Google snapshots but ordinary local removal does not", async () => {
  useEventsStore.getState().loadEvents([event, { ...event, id: "local", originCalendarID: "local", calendars: ["local"] }]);
  await useEventsStore.getState().localRemoveCalendarEvents("source");
  expect([...useEventsStore.getState().retiredGoogleEventIDs]).toEqual([event.id]);
  await useEventsStore.getState().localRemoveCalendarEvents("local");
  expect([...useEventsStore.getState().retiredGoogleEventIDs]).toEqual([event.id]);
});

it("account reset clears modal snapshots as well as Google removal evidence", () => {
  useEventsStore.getState().loadEvents([event]);
  useEditComposerStore.getState().open(event);
  useEventDetailStore.getState().open(event);
  resetEventModalSnapshots();
  useEventsStore.getState().resetEvents();
  expect(useEditComposerStore.getState()).toMatchObject({ prefilled: undefined, master: undefined, visible: false });
  expect(useEventDetailStore.getState()).toMatchObject({ event: null, visible: false });
  useEventsStore.getState().loadEvents([], { reconciled: true });
  expect(useEventsStore.getState().retiredGoogleEventIDs.size).toBe(0);
});

it("a fresh reconciled revival permits a new detail while the retired snapshot stays closed", async () => {
  const { liveEventDetail } = await import("@/lib/liveEvent");
  useEventsStore.getState().loadEvents([event]);
  await useEventsStore.getState().localRemoveCalendarEvents("source");
  const detail = (snapshot: typeof event) => {
    const state = useEventsStore.getState();
    return liveEventDetail(state.events, snapshot, state.retiredGoogleEventIDs, state.retiredGoogleEventRevisions);
  };
  useEventsStore.getState().loadEvents([event], { reconciled: true });
  expect(detail(event)).toBeNull();
  const fresh = { ...event, revision: 3, title: "Fresh native read" };
  useEventsStore.getState().loadEvents([fresh]);
  expect(detail(fresh)).toBeNull(); // stale/reappearing cache is not confirmation
  useEventsStore.getState().loadEvents([fresh], { reconciled: true });
  expect(detail(fresh)?.title).toBe("Fresh native read");
  expect(detail(event)).toBeNull();
});

it("keeps the retirement cutoff when an older removal arrives before a fresh revival", async () => {
  const { liveEventDetail } = await import("@/lib/liveEvent");
  const opened = { ...event, revision: 4 };
  useEventsStore.getState().loadEvents([opened]);
  await useEventsStore.getState().localRemoveEvent({ ...event, revision: 5 });
  await useEventsStore.getState().localRemoveEvent({ ...event, revision: 3 });
  expect(useEventsStore.getState().retiredGoogleEventRevisions.get(event.id)).toBe(5);
  const fresh = { ...event, revision: 6, title: "Fresh native read" };
  useEventsStore.getState().loadEvents([fresh], { reconciled: true });
  const state = useEventsStore.getState();
  expect(state.retiredGoogleEventIDs.has(event.id)).toBe(false);
  expect(liveEventDetail(state.events, opened, state.retiredGoogleEventIDs, state.retiredGoogleEventRevisions)).toBeNull();
  expect(liveEventDetail(state.events, fresh, state.retiredGoogleEventIDs, state.retiredGoogleEventRevisions)?.title).toBe("Fresh native read");
});

it("reconciles a large mixed Google snapshot and keeps only missing identities retired", () => {
  const prior = Array.from({ length: 2000 }, (_, i) => ({ ...event, id: `event-${i}` }));
  useEventsStore.getState().loadEvents(prior);
  const incoming = prior.filter((_, i) => i % 3 !== 0);
  useEventsStore.getState().loadEvents(incoming, { reconciled: true });
  expect(useEventsStore.getState().events).toEqual(incoming);
  expect([...useEventsStore.getState().retiredGoogleEventIDs].sort()).toEqual(prior.filter((_, i) => i % 3 === 0).map(row => row.id).sort());
});

});
