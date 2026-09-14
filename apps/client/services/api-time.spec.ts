import { beforeEach, expect, it, vi } from "vitest";
import { EventSchema } from "@musubi/types";
import { resolveEventTimeEdit } from "@musubi/calendar";

const h = vi.hoisted(() => ({ fetch: vi.fn(), remote: false }));
vi.mock("@/contexts/ServerContext", () => ({ useServer: () => ({ apiUrl: "https://home.test", authClient: { $fetch: h.fetch } }) }));
vi.mock("expo-secure-store", () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock("@/services/federation", async (importOriginal) => ({
  ...await importOriginal<typeof import("./federation")>(),
  remoteForCalendar: () => h.remote ? { id: "connection", label: "Origin", server: "https://origin.test", userID: "owner" } : null,
}));
vi.mock("@/services/notifications", () => ({ setReminderWriter: vi.fn() }));
vi.mock("@/lib/signOut", () => ({ notifySessionExpired: vi.fn() }));
vi.mock("@/lib/network", () => ({ fetchWithTimeout: vi.fn() }));
import { useApi } from "./api";

beforeEach(() => { h.fetch.mockReset(); h.remote = false; });
it.each([false, true])("preserves explicit-time create through native transport (remote=%s)", async (remote) => {
  h.remote = remote;
  const time = { kind: "zoned" as const, timeZone: "Europe/Prague", startLocal: "2026-10-25T02:15:00.000", endLocal: "2026-10-25T03:15:00.000" };
  const event = EventSchema.parse({ ...resolveEventTimeEdit(time), id: "00000000-0000-4000-8000-000000000018", revision: 3, title: "Fold", color: "red", creatorID: "owner", organizer: "owner", calendars: ["00000000-0000-4000-8000-000000000019"], isCanceled: false });
  h.fetch.mockResolvedValue({ data: JSON.parse(JSON.stringify(event)), error: null });
  const api = useApi();
  const created = await api.createEvent({ ...event, timeEdit: time });
  const [url, options] = h.fetch.mock.calls[0];
  expect(url).toBe(`https://home.test${remote ? "/api/v1/federation/s/connection" : ""}/api/v1/events/time`);
  expect(options.method).toBe("POST");
  const body = JSON.parse(options.body);
  expect(body).toMatchObject({ time, event: { id: event.id, calendars: event.calendars } });
  expect(body.event).not.toHaveProperty("start");
  expect(created.timeModel).toEqual(event.timeModel);
  expect(created.start).toEqual(event.start);
  await expect(api.createEvent(event)).rejects.toThrow(/time-model-aware copy/);
  expect(h.fetch).toHaveBeenCalledTimes(1);
});
