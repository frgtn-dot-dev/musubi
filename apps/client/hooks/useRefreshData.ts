import { useApi } from "@/services/api";
import { useCalendarsStore } from "@/store/useCalendarsStore";
import { useEventsStore } from "@/store/useEventsStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { cacheDeleteEvents, cacheGetAllEvents, cacheUpsertEvents, getLastSync, setLastSync } from "@/services/eventsCache";

export function useRefreshData() {
  const api = useApi();
  const { loadCalendars } = useCalendarsStore();
  const { loadEvents } = useEventsStore();
  const { loadSettings } = useSettingsStore();

  return async () => {
    // trigger server-side provider sync first, so its imported/changed events
    // show up in the delta below (best-effort, no-op for unconnected providers)
    try { await api.getGoogleCalendars(); } catch (e) { console.error("Sync failed:", e); }

    // delta: only events changed since our last sync (+ tombstones to drop)
    const since = await getLastSync();
    const { events, deletedIds, serverTime } = await api.getEvents(since ? new Date(since) : undefined);
    await cacheUpsertEvents(events);
    await cacheDeleteEvents(deletedIds);
    await setLastSync(serverTime);

    const [settings, calendars, all] = await Promise.all([
      api.getSettings(),
      api.getCalendars(),
      cacheGetAllEvents(),
    ]);
    loadSettings(settings);
    loadCalendars(calendars);
    loadEvents(all);
  };
}
