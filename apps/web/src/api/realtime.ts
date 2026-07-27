import { PageDocumentSchema, type PageDocument } from "@musubi/types";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getServerOrigin, queryKeys } from "./query-keys";

// Merge a realtime Page into the cached list, keeping it idempotent: a strictly
// newer revision replaces, an equal/older one is ignored. That drops the echo of
// the change the originating tab already applied, and keeps two tabs converged.
export function upsertPageIntoList(
  list: PageDocument[],
  page: PageDocument,
): PageDocument[] {
  const existing = list.find((item) => item.id === page.id);
  if (!existing) return [...list, page];
  if (existing.revision >= page.revision) return list;
  return list.map((item) => (item.id === page.id ? page : item));
}

type RealtimeMessage = { type?: string; payload?: Record<string, unknown> };

// Same-origin SSE. The browser `EventSource` can't set a bearer header, so this
// relies on the Better Auth cookie session the web already uses, and reconnects
// on its own. Cross-session cache updates flow through here.
export function useServerStream(userId: string) {
  const queryClient = useQueryClient();
  const origin = getServerOrigin();

  useEffect(() => {
    if (typeof window === "undefined" || userId === "anonymous") return;

    const source = new EventSource("/api/stream");
    const pagesKey = queryKeys.pages(origin, userId);
    const settingsKey = queryKeys.settings(origin, userId);
    const calendarsKey = queryKeys.calendars(origin, userId);
    const federatedKey = queryKeys.federated(origin, userId);
    // Event ranges share this prefix; a prefix match invalidates every window.
    const eventsPrefix = ["events", origin, userId] as const;

    function applyPage(raw: unknown) {
      const parsed = PageDocumentSchema.safeParse(raw);
      if (!parsed.success) {
        void queryClient.invalidateQueries({ queryKey: pagesKey });
        return;
      }
      queryClient.setQueryData<PageDocument[]>(pagesKey, (current) =>
        upsertPageIntoList(current ?? [], parsed.data),
      );
    }

    source.onmessage = (event) => {
      let message: RealtimeMessage;
      try {
        message = JSON.parse(event.data) as RealtimeMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case "page_created":
        case "page_updated":
          applyPage(message.payload?.page);
          break;
        case "page_removed":
          queryClient.setQueryData<PageDocument[]>(pagesKey, (current) =>
            (current ?? []).filter((page) => page.id !== message.payload?.id),
          );
          break;
        case "settings_updated":
          void queryClient.invalidateQueries({ queryKey: settingsKey });
          break;
        // Something changed on a connected Musubi server. Its rows live in the
        // federation snapshot, so refetch that rather than patching local caches.
        case "federated_sync":
          void queryClient.invalidateQueries({ queryKey: federatedKey });
          break;
        case "calendar_updated":
        case "calendar_removed":
          void queryClient.invalidateQueries({ queryKey: calendarsKey });
          void queryClient.invalidateQueries({ queryKey: eventsPrefix });
          break;
        case "event_created":
        case "event_updated":
        case "event_removed":
        case "attendance_changed":
        case "external_sync":
          void queryClient.invalidateQueries({ queryKey: eventsPrefix });
          break;
        default:
          break;
      }
    };

    return () => source.close();
  }, [origin, queryClient, userId]);
}
