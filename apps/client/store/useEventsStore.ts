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

// Request-scoped fence also covers unversioned full access-loss reconciliation.
let inboundRemovalGeneration = 0;

export const useEventsStore = create<EventsStore>((set, get) => ({
  events: [],
  addEvent: async (event, api) => {
    const generation = inboundRemovalGeneration;
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
      if (generation === inboundRemovalGeneration) await acceptServerEvent(result);
    } catch (error) {
      if (error instanceof EventMutationError && (error.localCommitted || error.current)) {
        if (generation === inboundRemovalGeneration) await acceptMutationFailure(error);
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
    }
  },
  localAddEvent: async (event: Event) => {
    if (get().events.some((e) => e.id === event.id)) return;
    set((state) => ({ events: [...state.events, event] }));
    await cacheUpsertEvents([event]).catch((e) => console.warn("Event cache write failed:", e),
    );
  },
  linkEvent: async (event, calendarID, api) => {
    const generation = inboundRemovalGeneration;
    try {
      const result = await api.linkEvent(event.id, calendarID, requireEventRevision(event));
      if (generation === inboundRemovalGeneration) await acceptServerEvent(result);
    } catch (error) {
      if (generation === inboundRemovalGeneration) await acceptMutationFailure(error); throw error; }
  },
  forkEvent: async (event, calendarID, api) => {
    const generation = inboundRemovalGeneration;
    try {
      const result = await api.forkEvent(event.id, calendarID, requireEventRevision(event));
      if (generation === inboundRemovalGeneration) await acceptServerEvent(result);
    } catch (error) {
      if (generation === inboundRemovalGeneration) await acceptMutationFailure(error); throw error; }
  },
  loadEvents: (events) => {
    inboundRemovalGeneration++;
    set({
    events });
  },
  removeEvent: async (event, api, unlinkCalendarID) => {
    const generation = inboundRemovalGeneration;
    try {
      const result = await api.removeEvent(event, unlinkCalendarID);
      if (generation !== inboundRemovalGeneration) return;
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
          },
        );
    } catch (error) {
      if (generation === inboundRemovalGeneration) await acceptMutationFailure(error);
      throw error;
    }
  },
  localRemoveEvent: async (event) => {
    inboundRemovalGeneration++;
    const current = get().events.find((e) => e.id === event.id);
    if ((current?.revision ?? 0) > (event.revision ?? 0)) return;
    set((state) => ({ events: [...state.events.filter((e) => e.id !== event.id)],
    }));
    await cacheDeleteEvents([event.id]).catch((e) => console.warn("Event cache delete failed:", e),
    );
    void cancelEventNotification(event.id).catch(() => { });
  },
  updateEvent: async (event, api) => {
    requireEventRevision(event);
    const generation = inboundRemovalGeneration;
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
      if (generation === inboundRemovalGeneration) await acceptServerEvent(result);
      return result;
    } catch (error) {
      if (error instanceof EventMutationError && (error.localCommitted || error.current)) {
        if (generation === inboundRemovalGeneration) await acceptMutationFailure(error);
        throw error;
      }
      if (previous && get().events.find((e) => e.id === event.id) === event) {
        set((state) => ({
          events: [...state.events.filter((e) => e.id !== event.id), previous],
        }));
        void cacheUpsertEvents([previous]);
      }
      throw error;
    }
  },
  localUpdateEvent: async (event) => {
    event = EventSchema.parse(event);
    const current = get().events.find((e) => e.id === event.id);
    if ((current?.revision ?? 0) > (event.revision ?? 0)) return;
    set((state) => ({
      events: [...state.events.filter((e) => e.id !== event.id), event],
    }));
    await cacheUpsertEvents([event]).catch((e) => console.warn("Event cache write failed:", e),
    );
    // Scoped to this event: an SSE burst updates events one by one, and a full
    // pass per message would re-resolve the whole calendar each time.
    void syncScheduledReminders([event], { onlyEventIDs: [event.id] }).catch(() => { },
    );
  },
  // Lost access to a calendar (kicked / calendar deleted): strip its link from
  // every event, drop events that lived only there — memory AND cache, so they
  // don't linger until sign-out.
  localRemoveCalendarEvents: async (calendarID) => {
    inboundRemovalGeneration++;
    const kept: Event[] = [], dropped: string[] = [], changed: Event[] = [];
    for (const e of get().events) {
      if (!e.calendars?.includes(calendarID)) { kept.push(e); continue; }
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
    dropped.forEach((id) => { void cancelEventNotification(id).catch(() => { }); });
  },
}));

async function acceptServerEvent(event: Event) {
  await useEventsStore.getState().localUpdateEvent(EventSchema.parse(event));
}
async function acceptMutationFailure(error: unknown) {
  if (!(error instanceof EventMutationError) || !error.current) return;
  const current = useEventsStore
    .getState()
    .events.find((e) => e.id === error.current!.id);
  if ((current?.revision ?? 0) > (error.current.revision ?? 0)) return;
  if (error.current.deletedAt)
    await useEventsStore.getState().localRemoveEvent(error.current);
  else await acceptServerEvent(error.current);
}
