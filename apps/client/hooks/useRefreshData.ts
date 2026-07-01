import { useApi } from "@/services/api";
import { useCalendarsStore } from "@/store/useCalendarsStore";
import { useEventsStore } from "@/store/useEventsStore";
import { useSettingsStore } from "@/store/useSettingsStore";

export function useRefreshData() {
  const api = useApi();
  const { loadCalendars } = useCalendarsStore();
  const { loadEvents } = useEventsStore();
  const { loadSettings } = useSettingsStore();

  return async () => {
    const gStatus = await api.checkGoogleStatus();
    if (gStatus.calendarConnected) await api.getGoogleCalendars();   // = sync
    const [settings, calendars, events] = await Promise.all([
      api.getSettings(), api.getCalendars(), api.getEvents(),
    ]);
    loadSettings(settings); loadCalendars(calendars); loadEvents(events);
  };
}

