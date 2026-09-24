import { useApi } from "./api";
import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ fetch: vi.fn(), url: "https://home.test", expired: vi.fn(), federate: vi.fn() }));
vi.mock("@/contexts/ServerContext", () => ({ useServer: () => ({ apiUrl: h.url, authClient: { $fetch: h.fetch } }) }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("@/services/federation", () => ({ setHomeRequester: vi.fn(), remoteForCalendar: () => ({ id: "remote" }), fedFetch: h.federate }));
vi.mock("@/services/notifications", () => ({ setReminderWriter: vi.fn() }));
vi.mock("@/lib/signOut", () => ({ notifySessionExpired: h.expired }));
vi.mock("@/lib/network", () => ({ fetchWithTimeout: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const occurrence = { eventID: id(4), start: "2026-10-01T12:00:00Z", end: "2026-10-01T13:00:00Z" };
const result = { operationID: id(3), eventID: id(1), title: "Walk", meeting: false, timeZone: "Asia/Kathmandu", expiresAt: "2099-01-01T00:00:00Z", offsetMinutes: 30, status: "preview", items: [{ ...occurrence, newStart: "2026-10-01T12:30:00Z", newEnd: "2026-10-01T13:30:00Z", status: "pending" }] };
const options = { eventID: id(1), calendarID: id(2), version: "a".repeat(64), title: "Walk", meeting: false, timeZone: "Asia/Kathmandu", preserved: { edited: 0, cancelled: 0, unavailable: 0 }, occurrences: [occurrence] };
const request = { operationID: id(3), eventID: id(1), calendarID: id(2), expectedVersion: options.version, eventIDs: [id(4)], offsetMinutes: 30 };
beforeEach(() => { vi.resetAllMocks(); h.url = "https://home.test"; });
it("uses the captured home account and global-zone opt-in for all five endpoints", async () => {
  const api = useApi(); const oldFetch = h.fetch; h.url = "https://other.test"; h.fetch = vi.fn();
  oldFetch.mockResolvedValueOnce({ data: options }).mockResolvedValueOnce({ data: null }).mockResolvedValue({ data: result });
  expect(await api.getOutlookMoveOptions(id(1))).toEqual(options);
  expect(await api.getLatestOutlookMove(id(1))).toBeNull();
  await api.previewOutlookMove(request); await api.startOutlookMove(id(3)); await api.getOutlookMove(id(3));
  expect(oldFetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
    [`https://home.test/api/v1/events/${id(1)}/outlook-move/options?outlookOrganizer=10`, "GET"],
    [`https://home.test/api/v1/events/${id(1)}/outlook-move?outlookOrganizer=10`, "GET"],
    ["https://home.test/api/v1/outlook-moves/preview?outlookOrganizer=10", "POST"],
    [`https://home.test/api/v1/outlook-moves/${id(3)}/start?outlookOrganizer=10`, "POST"],
    [`https://home.test/api/v1/outlook-moves/${id(3)}?outlookOrganizer=10`, "GET"],
  ]);
  expect(JSON.parse(oldFetch.mock.calls[2][1].body)).toEqual(request); expect(oldFetch.mock.calls[3][1].body).toBe("{}");
  expect(h.federate).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled(); h.fetch = oldFetch;
});
it("validates request and response contracts", async () => {
  const api = useApi(); await expect(api.previewOutlookMove({ ...request, offsetMinutes: 0 })).rejects.toThrow(); expect(h.fetch).not.toHaveBeenCalled();
  h.fetch.mockResolvedValue({ data: { ...result, unexpected: true } }); await expect(api.getOutlookMove(id(3))).rejects.toThrow();
});
it("forwards cancellation and expires unauthorized sessions without leaking server details", async () => {
  const controller = new AbortController(); let signal: AbortSignal | undefined;
  h.fetch.mockImplementation(async (_url, init) => { signal = init.signal; controller.abort(); return { error: { status: 401, message: "private upstream detail" } }; });
  await expect(useApi().getLatestOutlookMove(id(1), controller.signal)).rejects.toThrow("Could not verify this move");
  expect(signal?.aborted).toBe(true); expect(h.expired).toHaveBeenCalledOnce();
});
