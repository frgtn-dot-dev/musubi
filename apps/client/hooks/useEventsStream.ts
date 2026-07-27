import { useEventsStore } from "@/store/useEventsStore";
import { useEffect, useRef } from "react";
import EventSource from "react-native-sse";
import * as Network from "expo-network";
import { useCalendarsStore } from "@/store/useCalendarsStore";
import { useAttendeesStore } from "@/store/useAttendeesStore";
import { useServer } from "@/contexts/ServerContext";
import { useRefreshData } from "@/hooks/useRefreshData";

export function useConnectToEventStream() {
  // apiUrl comes from ServerContext (SecureStore-backed, self-host aware) — the
  // same origin every other request uses, so the SSE stream tracks a custom
  // server URL too.
  const { authClient, apiUrl } = useServer();
  const { localAddEvent, localUpdateEvent, localRemoveEvent, localRemoveCalendarEvents } = useEventsStore();
  const { localUpdateCalendar, localRemoveCalendar } = useCalendarsStore();
  const setAttendees = useAttendeesStore((s) => s.setAttendees);
  // "external_sync" = the server's scheduled provider sync found changes → run a
  // silent delta refresh (WITHOUT re-triggering the provider sync — that'd loop).
  // Ref so the SSE effect doesn't resubscribe every render; guarded against overlap.
  const refresh = useRefreshData();
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; });
  const refreshing = useRef(false);
  const silentRefresh = async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try { await refreshRef.current({ providerSync: false }); }
    catch (e) { console.warn("SSE-triggered refresh failed:", e); }
    finally { refreshing.current = false; }
  };

  // Offline → online (airplane mode off, wifi back): sync right away instead
  // of waiting out the SSE retry cycle. Same guarded refresh, so the two
  // triggers can't overlap. Refs only inside — mount-once is safe.
  useEffect(() => {
    let wasOffline = false;
    const sub = Network.addNetworkStateListener(({ isConnected, isInternetReachable }) => {
      const offline = isConnected === false || isInternetReachable === false;
      if (wasOffline && !offline) silentRefresh();
      wasOffline = offline;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!apiUrl) return;
    const sources: EventSource[] = [];
    let cancelled = false;

    const handleMessage = (event: { data?: string | null }) => {
      if (!event.data) return;
      const data = JSON.parse(event.data);

      const toEvent = (p: any) => ({ ...p, start: new Date(p.start), end: new Date(p.end) });

      switch (data.type) {
        case "event_created":
          localAddEvent(toEvent(data.payload));
          break;
        case "event_updated":
          localUpdateEvent(toEvent(data.payload));
          break;
        case "event_removed":
          localRemoveEvent(toEvent(data.payload));
          break;
        case "calendar_updated":
          localUpdateCalendar(data.payload);
          break;
        case "calendar_removed":
          localRemoveCalendar(data.payload);
          localRemoveCalendarEvents(data.payload.id);
          break;
        case "attendance_changed":
          setAttendees(data.payload.eventID, data.payload.attendees);
          break;
        case "external_sync":
          silentRefresh();
          break;
        // A connected Musubi server changed something; the home server relays it
        // (ADR-005). Remote rows are pulled per server, so refresh rather than
        // patching a payload from a foreign origin into the local stores.
        case "federated_sync":
          silentRefresh();
          break;
        default:
          console.warn(`Uknown event type: ${data.type}`);
      }
    };

    const subscribe = (url: string, token: string) => {
      const sse = new EventSource(`${url}/api/stream`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // The library auto-reconnects every pollingInterval (5s) after an error or
      // stream end — but frames sent while we were down are lost. Catch up with
      // one silent delta refresh on the reconnect that follows an error.
      let hadError = false;
      sse.addEventListener("error", () => { hadError = true; });
      sse.addEventListener("open", () => {
        if (hadError) { hadError = false; silentRefresh(); }
      });
      sse.addEventListener("message", handleMessage);
      sources.push(sse);
    };

    // One stream, to the home server. Federated servers used to get a stream
    // each (member token as bearer); since ADR-005 the home server subscribes to
    // them on our behalf and relays their events as `federated_sync`, so remote
    // calendars stay live without this device holding a credential — and a
    // freshly accepted server starts streaming immediately instead of on the
    // next app start.
    const connect = async () => {
      const { data } = await authClient.getSession();
      const token = data?.session?.token;
      if (cancelled || !token) return;
      subscribe(apiUrl, token);
    }
    connect();
    return () => { cancelled = true; sources.forEach(s => s.close()); };
  }, [apiUrl, authClient]);
}
