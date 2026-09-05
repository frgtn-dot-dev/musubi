import {
  EventSchema,
  EventMutationError,
  requireEventRevision,
  type Event,
  type EventWriteRequest,
} from "@musubi/types";
import type { useApi } from "@/services/api";
import { create } from "zustand";
import { cancelEventNotification, syncScheduledReminders,
} from "@/services/notifications";
import { cacheDeleteEvents, cacheUpsertEvents } from "@/services/eventsCache";

type EventsStore = {
  events: Event[];
  resetEvents: () => void;
  addEvent: (event: Event, api: ReturnType<typeof useApi>) => Promise<void>;
  localAddEvent: (event: Event) => Promise<void>;
  loadEvents: (events: Event[]) => void;
  removeEvent: (event: Event, api: ReturnType<typeof useApi>, unlinkCalendarID?: string,
  ) => Promise<void>;
  localRemoveEvent: (event: Event) => Promise<void>;
  updateEvent: (event: Event, api: ReturnType<typeof useApi>) => Promise<Event>;
  localUpdateEvent: (event: Event) => Promise<void>;
  localRemoveCalendarEvents: (calendarID: string) => Promise<void>;
  linkEvent: (event: Event, calendarID: string, api: ReturnType<typeof useApi>,
  ) => Promise<void>;
  forkEvent: (event: Event, calendarID: string, api: ReturnType<typeof useApi>,
  ) => Promise<void>;
};

// Ordering evidence lives only for in-flight requests, and is invalidated at
// account/server reset. Source identity and a server-assigned create/fork ID
// are deliberately not conflated.
type ReceiptFence = {
  removals: Map<string, number | undefined>;
  full?: Set<string>;
  reset: boolean;
};
const pendingReceipts = new Set<ReceiptFence>();
let eventLifecycle = 0;
export function getEventLifecycle() { return eventLifecycle; }
function captureReceiptFence(): ReceiptFence {
  const fence: ReceiptFence = { removals: new Map(), reset: false };
  pendingReceipts.add(fence);
  return fence;
}
function recordRemoval(id: string, revision?: number) {
  for (const fence of pendingReceipts) {
    const previous = fence.removals.get(id);
    fence.removals.set(id, fence.removals.has(id) && previous === undefined
      ? undefined : revision === undefined ? undefined : Math.max(previous ?? 0, revision));
  }
}
function receiptOrder(event: Event, fence: ReceiptFence) {
  if (fence.reset) return "stale";
  if (fence.removals.has(event.id)) {
    const revision = fence.removals.get(event.id);
    if (revision === undefined) return "ambiguous";
    return (event.revision ?? 0) > revision ? "safe" : "stale";
  }
  if (fence.full && !fence.full.has(event.id)) return "ambiguous";
  return "safe";
}
function supersededReceipt() {
  return new EventMutationError(
    "Saved locally, but the event changed or is no longer available. Refresh and reconcile. Your draft was kept.", true,
  );
}

export const useEventsStore = create<EventsStore>((set, get) => ({
  events: [],
  resetEvents: () => {
    eventLifecycle++;
    for (const fence of pendingReceipts) fence.reset = true;
    pendingReceipts.clear();
    set({ events: [] });
  },
  addEvent: async (event, api) => {
    const fence = captureReceiptFence();
    const request = event;
    const { scopeEdit: _intent,
      contentPatch: _patch,
      ...snapshot } = event as EventWriteRequest;
    event = { ...snapshot, revision: undefined }; // a new identity has no source revision
    const previous = get().events.find((e) => e.id === event.id);
    set((state) => ({ events: [...state.events.filter((e) => e.id !== event.id), event],
    }));
    void cacheUpsertEvents([event]);
    try {
      const result = await api.createEvent(request);
      if (result.id !== event.id && get().events.find(e => e.id === event.id) === event) {
        set(state => ({ events: state.events.filter(e => e.id !== event.id) }));
        await cacheDeleteEvents([event.id]).catch(e => console.warn("Event cache delete failed:", e));
      }
      await acceptServerEvent(result, fence, api);
    } catch (error) {
      if (error instanceof EventMutationError && (error.localCommitted || error.current)) {
        if (error.current && error.current.id !== event.id && get().events.find(e => e.id === event.id) === event) {
          set(state => ({ events: state.events.filter(e => e.id !== event.id) }));
          await cacheDeleteEvents([event.id]).catch(e => console.warn("Event cache delete failed:", e));
        }
        await acceptMutationFailure(error, fence, api);
        throw error;
      }
      if (get().events.find((e) => e.id === event.id) !== event) throw error;
      set((state) => ({
        events: previous
          ? [...state.events.filter((e) => e.id !== event.id), previous]
          : state.events.filter((e) => e.id !== event.id),
      }));
      if (previous) void cacheUpsertEvents([previous]);
      else void cacheDeleteEvents([event.id]);
      throw error;
    } finally {
      pendingReceipts.delete(fence);
    }
  },
  localAddEvent: async (event: Event) => {
    if (get().events.some((e) => e.id === event.id)) return;
    set((state) => ({ events: [...state.events, event] }));
    await cacheUpsertEvents([event]).catch((e) => console.warn("Event cache write failed:", e),
    );
  },
  linkEvent: async (event, calendarID, api) => {
    const fence = captureReceiptFence();
    try {
      const result = await api.linkEvent(event.id, calendarID, requireEventRevision(event));
      await acceptServerEvent(result, fence, api);
    } catch (error) {
      await acceptMutationFailure(error, fence, api); throw error;
    } finally {
      pendingReceipts.delete(fence); }
  },
  forkEvent: async (event, calendarID, api) => {
    const fence = captureReceiptFence();
    try {
      const result = await api.forkEvent(event.id, calendarID, requireEventRevision(event));
      await acceptServerEvent(result, fence, api);
    } catch (error) {
      await acceptMutationFailure(error, fence, api); throw error;
    } finally {
      pendingReceipts.delete(fence); }
  },
  loadEvents: (events) => {
    const next = new Map(events.map(event => [event.id, event]));
    for (const current of get().events) {
      const incoming = next.get(current.id);
      if (!incoming || current.calendars.some(id => !incoming.calendars.includes(id))) {
        recordRemoval(current.id);
      }
    }
    for (const fence of pendingReceipts) {
      fence.full = new Set(next.keys());
      for (const id of fence.removals.keys()) {
        if (!next.has(id)) fence.removals.set(id, undefined);
      }
    }
    set({
    events });
  },
  removeEvent: async (event, api, unlinkCalendarID) => {
    const fence = captureReceiptFence();
    try {
      const result = await api.removeEvent(event, unlinkCalendarID);
      if (fence.reset) return;
      const current = get().events.find((e) => e.id === event.id);
      if ((current?.revision ?? 0) > (result.revision ?? event.revision ?? 0))
        return;
      if (result.removed)
        await get().localRemoveEvent({
          ...event,
          revision: result.revision ?? event.revision,
        });
      else
        await acceptServerEvent(
          result.event ?? {
            ...event,
            revision: result.revision,
            calendars: result.calendars,
          }, fence, api,
        );
    } catch (error) {
      await acceptMutationFailure(error, fence, api);
      throw error;
    } finally {
      pendingReceipts.delete(fence);
    }
  },
  localRemoveEvent: async (event) => {
    const lifecycle = eventLifecycle;
    const current = get().events.find((e) => e.id === event.id);
    if ((current?.revision ?? 0) > (event.revision ?? 0)) return;
    recordRemoval(event.id, event.revision);
    set((state) => ({ events: [...state.events.filter((e) => e.id !== event.id)],
    }));
    await cacheDeleteEvents([event.id]).catch((e) => console.warn("Event cache delete failed:", e),
    );
    if (lifecycle === eventLifecycle && !get().events.some(e => e.id === event.id)) {
      void cancelEventNotification(event.id).catch(() => { });
  }
  },
  updateEvent: async (event, api) => {
    requireEventRevision(event);
    const fence = captureReceiptFence();
    const request = event;
    const { scopeEdit: _intent,
      contentPatch: _patch, ...snapshot } = event as EventWriteRequest;
    event = snapshot; // keep intent only on the API request
    const previous = get().events.find((e) => e.id === event.id);
    // A known newer inbound row is never replaced by this older draft.
    if (previous && (previous.revision ?? 0) <= (event.revision ?? 0)) {
        set((state) => ({ events: [...state.events.filter((e) => e.id !== event.id), event],
      }));
      void cacheUpsertEvents([event]);
    }
    try {
      const result = await api.updateEvent(request);
      return await acceptServerEvent(result, fence, api);
    } catch (error) {
      if (error instanceof EventMutationError && (error.localCommitted || error.current)) {
        await acceptMutationFailure(error, fence, api);
        throw error;
      }
      if (previous && get().events.find((e) => e.id === event.id) === event) {
        set((state) => ({
          events: [...state.events.filter((e) => e.id !== event.id), previous],
        }));
        void cacheUpsertEvents([previous]);
      }
      throw error;
    } finally {
      pendingReceipts.delete(fence);
    }
  },
  localUpdateEvent: async (event) => {
    const lifecycle = eventLifecycle;
    event = EventSchema.parse(event);
    const current = get().events.find((e) => e.id === event.id);
    if ((current?.revision ?? 0) > (event.revision ?? 0)) return;
    set((state) => ({
      events: [...state.events.filter((e) => e.id !== event.id), event],
    }));
    await cacheUpsertEvents([event]).catch((e) => console.warn("Event cache write failed:", e),
    );
    if (lifecycle !== eventLifecycle || get().events.find(e => e.id === event.id) !== event) return;
    // Scoped to this event: an SSE burst updates events one by one, and a full
    // pass per message would re-resolve the whole calendar each time.
    void syncScheduledReminders([event], { onlyEventIDs: [event.id] }).catch(() => { },
    );
  },
  // Lost access to a calendar (kicked / calendar deleted): strip its link from
  // every event, drop events that lived only there — memory AND cache, so they
  // don't linger until sign-out.
  localRemoveCalendarEvents: async (calendarID) => {
    const lifecycle = eventLifecycle;
    const kept: Event[] = [], dropped: string[] = [], changed: Event[] = [];
    for (const e of get().events) {
      if (!e.calendars?.includes(calendarID)) { kept.push(e); continue; }
      recordRemoval(e.id);
      const calendars = e.calendars.filter((c) => c !== calendarID);
      if (calendars.length === 0) { dropped.push(e.id); continue; }
      const updated = { ...e, calendars };
      kept.push(updated); changed.push(updated);
    }
    set({ events: kept });
    await cacheDeleteEvents(dropped).catch((e) => console.warn("Event cache delete failed:", e),
    );
    await cacheUpsertEvents(changed).catch((e) => console.warn("Event cache write failed:", e),
    );
    if (lifecycle === eventLifecycle) dropped.forEach((id) => {
      if (!get().events.some(e => e.id === id)) void cancelEventNotification(id).catch(() => { }); });
  },
}));

async function reconcileReceipt(api: ReturnType<typeof useApi>) {
  const { refreshEventData } = await import("@/hooks/useRefreshData");
  await refreshEventData(api, { providerSync: false, full: true });
}

async function acceptServerEvent(event: Event, fence: ReceiptFence, api: ReturnType<typeof useApi>): Promise<Event> {
  const current = useEventsStore.getState().events.find(e => e.id === event.id);
  if ((current?.revision ?? 0) > (event.revision ?? 0)) throw supersededReceipt();
  const order = receiptOrder(event, fence);
  if (order !== "safe") {
    // Unknown full/access-loss ordering cannot silently finish a confirmed write.
    // Reconcile through the same home/federated/cache/reminder path as refresh.
    if (order === "ambiguous") {
      try { await reconcileReceipt(api); }
      catch { throw supersededReceipt(); }
      if (!fence.reset) {
        const refreshed = useEventsStore.getState().events.find(e => e.id === event.id);
        if (refreshed && (refreshed.revision ?? 0) >= (event.revision ?? 0)) return refreshed;
      }
    }
    throw supersededReceipt();
  }
  await useEventsStore.getState().localUpdateEvent(EventSchema.parse(event));
  const latest = useEventsStore.getState().events.find(e => e.id === event.id);
  if (receiptOrder(event, fence) !== "safe" || !latest || (latest.revision ?? 0) > (event.revision ?? 0)) {
    throw supersededReceipt();
  }
  return event;
}
async function acceptMutationFailure(error: unknown, fence: ReceiptFence, api: ReturnType<typeof useApi>) {
  if (!(error instanceof EventMutationError) || !error.current) return;
  const order = receiptOrder(error.current, fence);
  if (order !== "safe") {
    if (order === "ambiguous") {
      try { await reconcileReceipt(api); }
      catch { /* Preserve the original committed/error truth when refresh fails. */ }
    }
    return;
  }
  const current = useEventsStore
    .getState()
    .events.find((e) => e.id === error.current!.id);
  if ((current?.revision ?? 0) > (error.current.revision ?? 0)) return;
  if (error.current.deletedAt)
    await useEventsStore.getState().localRemoveEvent(error.current);
  else await useEventsStore.getState().localUpdateEvent(EventSchema.parse(error.current));
}
