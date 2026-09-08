import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventSchema } from "@musubi/types";
import { CalendarTimeError } from "./calendar-time-error";
import { useReminders } from "./use-reminders";
import { useWorkspaceQueries } from "./workspace-queries";

const fixture = vi.hoisted(() => ({
  getEvents: vi.fn(),
  schedule: vi.fn<(reminders: unknown[]) => ReturnType<typeof vi.fn>>(() => vi.fn()),
  remote: { calendars: [], events: [] as unknown[], servers: [] },
  remoteRefetch: vi.fn(),
}));
vi.mock("~/api/resources", () => ({
  getEvents: fixture.getEvents,
  getCalendars: async () => [],
  getPages: async () => [],
  getReminders: async () => ({
    default: { minutesBefore: 10, allDay: null },
    calendars: {},
    events: {},
  }),
  getSettings: async () => ({ calendarOrder: [], timezone: "UTC" }),
  getServerCapabilities: async () => ({}),
  getSettingsDocument: vi.fn(),
  patchSettings: vi.fn(),
  putReminderRule: vi.fn(),
}));
vi.mock("./federated-workspace", () => ({
  useFederatedWorkspace: () => ({
    data: fixture.remote,
    refetch: fixture.remoteRefetch,
  }),
}));
vi.mock("./reminder-scheduler", () => ({
  scheduleReminders: fixture.schedule,
  notifyReminder: vi.fn(),
  requestReminderPermission: vi.fn(),
}));
vi.mock("~/push/subscribe", () => ({
  currentSubscription: async () => null,
  pushSupported: () => false,
  reregisterPush: vi.fn(),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));
const event = {
  ...EventSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    creatorID: "owner",
    organizer: "owner",
    title: "Meeting",
    color: "red",
    calendars: ["calendar"],
    isAllDay: false,
    isCanceled: false,
    start: "2026-01-02T09:00:00Z",
    end: "2026-01-02T10:00:00Z",
    recurrence: "FREQ=DAILY;COUNT=2",
  }),
  timeModel: {
    kind: "zoned" as const,
    timeZone: "UTC",
    startLocal: "2026-01-02T09:00:00.000",
    endLocal: "2026-01-02T10:00:00.000",
  },
};
const invalid = { ...event, recurrence: "FREQ=HOURLY" };
const response = (events = [event]) => ({
  events,
  deletedIds: [],
  serverTime: "2026-01-01T00:00:00Z",
});
const clients: QueryClient[] = [];
function environment() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  fixture.getEvents.mockReset().mockResolvedValue(response());
  fixture.schedule.mockClear();
  fixture.remote = { calendars: [], events: [], servers: [] };
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.useRealTimers();
});

it("reports a reminder resolution error, cancels old timers, and recovers on retry", async () => {
  const { client, wrapper } = environment();
  const hook = renderHook(() => useReminders("owner"), { wrapper });
  try {
    await waitFor(() =>
      expect(fixture.schedule.mock.lastCall?.[0]).toHaveLength(2),
    );
    const cancelOld = fixture.schedule.mock.results.at(-1)!.value;
    const key = client
      .getQueryCache()
      .findAll()
      .find((query) => query.queryKey[0] === "events")!.queryKey;
    act(() => {
      client.setQueryData(key, response([invalid]));
    });
    await waitFor(() =>
      expect(hook.result.current?.error).toBeInstanceOf(CalendarTimeError),
    );
    expect(fixture.schedule.mock.lastCall?.[0]).toEqual([]);
    expect(cancelOld).toHaveBeenCalledOnce();
    expect(hook.result.current?.error?.message).toContain(
      "Your saved events have not changed",
    );
    await act(async () => {
      await hook.result.current?.retry?.();
    });
    await waitFor(() => expect(hook.result.current?.error).toBeUndefined());
    expect(fixture.schedule.mock.lastCall?.[0]).toHaveLength(2);
  } finally {
    hook.unmount();
  }
});

it("keeps home expansion failures in the query error channel and recovers with fresh definitions", async () => {
  fixture.getEvents.mockResolvedValue(response([invalid]));
  const { wrapper } = environment();
  const hook = renderHook(
    () => useWorkspaceQueries("2026-01-02", "owner", "week"),
    { wrapper },
  );
  try {
    await waitFor(() =>
      expect(hook.result.current.events.error).toBeInstanceOf(
        CalendarTimeError,
      ),
    );
    fixture.getEvents.mockResolvedValue(response());
    await act(async () => {
      await hook.result.current.events.refetch();
    });
    await waitFor(() =>
      expect(hook.result.current.mergedEvents?.events).toHaveLength(2),
    );
    expect(hook.result.current.events.error).toBeNull();
  } finally {
    hook.unmount();
  }
});

it("returns a federated expansion failure instead of throwing during render or returning a partial calendar", async () => {
  fixture.remote = { calendars: [], events: [invalid], servers: [] };
  const { wrapper } = environment();
  const hook = renderHook(
    () => useWorkspaceQueries("2026-01-02", "owner", "week"),
    { wrapper },
  );
  try {
    await waitFor(() =>
      expect(hook.result.current.expansionError).toBeInstanceOf(
        CalendarTimeError,
      ),
    );
    expect(hook.result.current.mergedEvents).toBeUndefined();
    expect(hook.result.current.events.data?.events).toHaveLength(2);
    fixture.remote = { calendars: [], events: [], servers: [] };
    hook.rerender();
    expect(hook.result.current.expansionError).toBeUndefined();
    expect(hook.result.current.mergedEvents?.events).toHaveLength(2);
  } finally {
    hook.unmount();
  }
});
