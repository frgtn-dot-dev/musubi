import { useEventsStore } from "@/store/useEventsStore";
import { useEffect, useRef } from "react";
import EventSource from "react-native-sse";
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

  useEffect(() => {
    if (!apiUrl) return;
    let sse: EventSource;

    const connect = async () => {
      const { data } = await authClient.getSession();
      const token = data?.session?.token;
      sse = new EventSource(`${apiUrl}/api/stream`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      sse.addEventListener("message", (event) => {
        if (event.data) {
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
            default:
              console.warn(`Uknown event type: ${data.type}`);
          }
        }
      });
    }
    connect();
    return () => sse?.close();
  }, [apiUrl, authClient]);
}
