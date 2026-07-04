import { Event } from "@musubi/types";
import { useApi } from "@/services/api";
import { create } from "zustand";
import { cancelEventPushNotification, getEventsNotificationIdentifier, removeNotification } from "@/services/notifications";
import { cacheDeleteEvents, cacheUpsertEvents } from "@/services/eventsCache";

type EventsStore = {
  events: Event[],
  addEvent: (event: Event, api: ReturnType<typeof useApi>) => Promise<void>;
  localAddEvent: (event: Event) => void;
  loadEvents: (events: Event[]) => void;
  removeEvent: (event: Event, api: ReturnType<typeof useApi>, unlinkCalendarID?: string) => Promise<void>;
  localRemoveEvent: (event: Event) => void;
  updateEvent: (event: Event, api: ReturnType<typeof useApi>) => Promise<void>;
  localUpdateEvent: (event: Event) => void;
}

export const useEventsStore = create<EventsStore>((set, get) => ({
  events: [],
  addEvent: async (event, api) => {
    const result = await api.createEvent(event);
    set((state) => ({
      events: [...state.events.filter(e => e.id !== result.id), result]
    }));
    cacheUpsertEvents([result]);
  },
  localAddEvent: (event: Event) => {
    if (get().events.some(e => e.id === event.id)) {
      return;
    }
    set((state) => ({
      events: [...state.events, event],
    }));
    cacheUpsertEvents([event]);
  },
  loadEvents: (events) => set(() => ({
    events: events,
  })),
  removeEvent: async (event, api, unlinkCalendarID) => {
    const result = await api.removeEvent(event, unlinkCalendarID);
    if (!result.removed) {
      // Still linked to calendars the user can't edit → keep it, just update links.
      const updated = { ...event, calendars: result.calendars };
      set((state) => ({ events: state.events.map(e => e.id === event.id ? updated : e) }));
      cacheUpsertEvents([updated]);
      return;
    }
    const identifier = await getEventsNotificationIdentifier(event.id);
    if (identifier !== null) {
      cancelEventPushNotification(identifier);
      removeNotification(event.id);
      console.log("=== REMOVED NOTIFICATION ===");
      console.log(identifier);
      console.log(event.id);
      console.log("============================");
    }
    set((state) => ({
      events: [...state.events.filter(e => e.id !== result.id)],
    }));
    cacheDeleteEvents([event.id]);
  },
  localRemoveEvent: (event) => {
    set((state) => ({
      events: [...state.events.filter(e => e.id !== event.id)],
    }));
    cacheDeleteEvents([event.id]);
  },
  updateEvent: async (event, api) => {
    const result = await api.updateEvent(event);
    set((state) => ({
      events: [...state.events.filter(e => e.id !== result.id), result],
    }));
    cacheUpsertEvents([result]);
  },
  localUpdateEvent: (event) => {
    set((state) => ({
      events: [...state.events.filter(e => e.id !== event.id), event],
    }));
    cacheUpsertEvents([event]);
  },
}));
