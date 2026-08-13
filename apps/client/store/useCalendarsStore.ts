import type { Calendar } from "@musubi/types";
import type { useApi } from "@/services/api";
import { create } from "zustand";


type CalendarStore = {
  calendars: Calendar[],
  activeCals: Set<string>;
  soloCalId: string | null;
  toggleCal: (id: string) => void;
  soloCalendar: (id: string) => void;
  syncActiveCals: (calendars: Calendar[]) => void;
  addCalendar: (calendar: Calendar, api: ReturnType<typeof useApi>) => Promise<Calendar>;
  loadCalendars: (calendars: Calendar[]) => void;
  removeCalendar: (calendar: Calendar, api: ReturnType<typeof useApi>) => Promise<void>;
  localRemoveCalendar: (calendar: Calendar) => void;
  updateCalendar: (calendar: Calendar, api: ReturnType<typeof useApi>) => Promise<Calendar>;
  localUpdateCalendar: (calendar: Calendar) => Calendar;
}


export const useCalendarsStore = create<CalendarStore>((set, get) => ({
  calendars: [],
  activeCals: new Set(),
  soloCalId: null,

  toggleCal: (id) => {
    const next = new Set(get().activeCals);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    set({ activeCals: next, soloCalId: null });
  },

  soloCalendar: (id) => {
    const { soloCalId, calendars } = get();

    if (soloCalId === id) {
      // Already soloed — revert to all calendars active
      set({
        activeCals: new Set(calendars.map(c => c.id)),
        soloCalId: null,
      });
    } else {
      // Solo this calendar (switch if another was soloed)
      set({
        activeCals: new Set([id]),
        soloCalId: id,
      });
    }
  },

  syncActiveCals: (calendars) => {
    const { activeCals, soloCalId } = get();
    if (soloCalId !== null) return; // don't disturb solo mode
    const now = new Set(activeCals);
    calendars.forEach(c => !now.has(c.id) && now.add(c.id));
    set({ activeCals: now });
  },

  addCalendar: async (calendar, api) => {
    set((state) => ({ calendars: [...state.calendars.filter(c => c.id !== calendar.id), calendar] }));
    try {
      const result = await api.createCalendar(calendar);
      set((state) => ({ calendars: [...state.calendars.filter(c => c.id !== calendar.id), result] }));
      return result;
    } catch (error) {
      set((state) => ({ calendars: state.calendars.filter(c => c.id !== calendar.id) }));
      throw error;
    }
  },

  loadCalendars: (calendars: Calendar[]) => set({ calendars }),

  removeCalendar: async (calendar, api) => {
    const previousActive = new Set(get().activeCals);
    const previousSolo = get().soloCalId;
    get().localRemoveCalendar(calendar);
    try {
      await api.removeCalendar(calendar);
    } catch (error) {
      set((state) => ({
        calendars: [...state.calendars.filter(c => c.id !== calendar.id), calendar],
        activeCals: previousActive,
        soloCalId: previousSolo,
      }));
      throw error;
    }
  },

  localRemoveCalendar: (calendar) => {
    set((state) => {
      const next = new Set(state.activeCals);
      next.delete(calendar.id);
      return {
        calendars: state.calendars.filter(c => c.id !== calendar.id),
        activeCals: next,
        soloCalId: state.soloCalId === calendar.id ? null : state.soloCalId,
      }
    });
  },

  updateCalendar: async (calendar, api) => {
    const previous = get().calendars.find(c => c.id === calendar.id);
    get().localUpdateCalendar(calendar);
    try {
      const result = await api.updateCalendar(calendar);
      // MERGE, don't replace: the update response is the raw calendars row and
      // omits per-user fields (role, provider…).
      return get().localUpdateCalendar(result);
    } catch (error) {
      if (previous) get().localUpdateCalendar(previous);
      throw error;
    }
  },

  localUpdateCalendar: (calendar) => {
    // MERGE, don't replace: SSE payloads may lack per-user fields (role,
    // provider) — replacing would silently drop edit rights until a refetch.
    const existing = get().calendars.find(c => c.id === calendar.id);
    const merged = existing ? { ...existing, ...calendar } : calendar;
    set((state) => ({
      calendars: [...state.calendars.filter(c => c.id !== calendar.id), merged],
    }));
    return merged;
  },
}));
