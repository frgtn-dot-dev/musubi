import { useApi } from "@/services/api";
import { useCalendarsStore } from "@/store/useCalendarsStore";
import { useEventsStore } from "@/store/useEventsStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { cacheDeleteEvents, cacheGetAllEvents, cacheReplaceAllEvents, cacheSetCalendars, cacheUpsertEvents, getLastSync, setLastSync } from "@/services/eventsCache";

export function useRefreshData() {
  const api = useApi();
  const { loadCalendars } = useCalendarsStore();
  const { loadEvents } = useEventsStore();
  const { loadSettings } = useSettingsStore();

  return async () => {
    // trigger server-side provider sync first, so its imported/changed events
    // show up in the delta below (best-effort, no-op for unconnected providers)
    try { await api.getGoogleCalendars(); } catch (e) { console.error("Sync failed:", e); }

    // delta: only events changed since our last sync (+ tombstones to drop).
    // Tolerate a garbage stored value → fall back to a full sync (self-heals).
    const lastSync = await getLastSync();
    const sinceDate = lastSync ? new Date(lastSync) : null;
    const since = sinceDate && !isNaN(sinceDate.getTime()) ? sinceDate : undefined;
    const { events, deletedIds, serverTime } = await api.getEvents(since);
    if (since === undefined) {
      await cacheReplaceAllEvents(events); // full sync = authoritative, drops any drift
    } else {
      await cacheUpsertEvents(events);
      await cacheDeleteEvents(deletedIds);
    }
    await setLastSync(serverTime);

    const [settings, calendars, all] = await Promise.all([
      api.getSettings(),
      api.getCalendars(),
      cacheGetAllEvents(),
    ]);
    loadSettings(settings);
    loadCalendars(calendars);
    loadEvents(all);
    cacheSetCalendars(calendars);
  };
}
