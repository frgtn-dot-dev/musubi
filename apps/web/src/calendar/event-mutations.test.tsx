import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EventMutationError, type Event } from "@musubi/types";
import { describe, expect, it, vi } from "vitest";
import { getServerOrigin } from "~/api/query-keys";
import { updateEvent } from "~/api/resources";
import { useEventMutations } from "./event-mutations";

vi.mock("~/api/resources", () => ({ updateEvent: vi.fn(), createEvent: vi.fn(), forkEvent: vi.fn(), linkEvent: vi.fn(), removeEvent: vi.fn(), setAttendance: vi.fn() }));
vi.mock("./federated-workspace", () => ({ useFederatedWorkspace: () => ({ data: { calendars: [] } }) }));

const event = { id: "event", revision: 1, title: "Frozen draft", calendars: ["home"], originCalendarID: "home" } as Event;

describe("event mutation receipt ordering", () => {
  for (const removal of ["tombstone", "access-loss"] as const) {
    for (const outcome of ["success", "current-error", "fallback-error"] as const) {
      it(`does not resurrect ${removal} after delayed ${outcome}`, async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
        const key = ["events", getServerOrigin(), "user", "range"];
        client.setQueryData(key, { events: [event], deletedIds: [], serverTime: "before" });
        let resolve!: (event: Event) => void;
        let reject!: (error: Error) => void;
        vi.mocked(updateEvent).mockImplementation(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const { result } = renderHook(() => useEventMutations("user"), { wrapper });
        let pending!: Promise<unknown>;
        await act(async () => { pending = result.current.updateEvent(event); });
        client.setQueryData(key, { events: [], deletedIds: removal === "tombstone" ? [event.id] : [], serverTime: "newer" });
        await act(async () => {
          if (outcome === "success") { resolve({ ...event, revision: 2 }); await pending; }
          else {
            reject(new EventMutationError("Saved locally", true, outcome === "current-error" ? { ...event, revision: 2 } : undefined));
            await expect(pending).rejects.toThrow("Saved locally");
          }
        });
        expect(client.getQueryData(key)).toMatchObject({ events: [], serverTime: "newer" });
        expect(event).toMatchObject({ revision: 1, title: "Frozen draft" });
        // Subsequent authoritative refresh/revival remains possible.
        client.setQueryData(key, { events: [{ ...event, revision: 4 }], deletedIds: [] });
        expect(client.getQueryData(key)).toMatchObject({ events: [{ revision: 4 }] });
        client.clear();
      });
    }
  }
});
