import type { Calendar } from "@musubi/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import { useCalendarTransfers } from "./calendar-transfers";

const api = vi.hoisted(() => ({
  disconnectExternalCalendar: vi.fn(),
  importCalendar: vi.fn(),
}));

vi.mock("~/api/resources", () => ({
  createCalendar: vi.fn(),
  disconnectExternalCalendar: api.disconnectExternalCalendar,
  exportCalendar: vi.fn(),
  importCalendar: api.importCalendar,
  removeCalendar: vi.fn(),
  updateCalendar: vi.fn(),
}));

const USER_ID = "alex";
const externalCalendar: Calendar = {
  accountId: "google-work",
  accountLabel: "work@example.com",
  color: "#7A8BA3",
  creatorID: USER_ID,
  id: "studio",
  members: [],
  name: "Studio",
  provider: "google",
  role: "owner",
};
const personalCalendar: Calendar = {
  color: "#D4A574",
  creatorID: USER_ID,
  id: "personal",
  isDefault: true,
  members: [],
  name: "Personal",
  role: "owner",
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const calendarsKey = queryKeys.calendars(getServerOrigin(), USER_ID);
  queryClient.setQueryData(calendarsKey, [personalCalendar, externalCalendar]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useCalendarTransfers(USER_ID), { wrapper });
  return { calendarsKey, hook, queryClient };
}

describe("external calendar disconnect", () => {
  beforeEach(() => api.disconnectExternalCalendar.mockReset());

  it("removes the mirror from the local cache after the write", async () => {
    api.disconnectExternalCalendar.mockResolvedValue({ id: "studio" });
    const { calendarsKey, hook, queryClient } = setup();

    await act(async () => {
      await hook.result.current.disconnectExternalCalendar(externalCalendar);
    });

    expect(
      queryClient.getQueryData<Calendar[]>(calendarsKey)?.map(({ id }) => id),
    ).toEqual(["personal"]);
    expect(api.disconnectExternalCalendar).toHaveBeenCalledWith("studio");
  });
});

describe("calendar import destination", () => {
  beforeEach(() => api.importCalendar.mockReset());

  it("passes the selected connected account to the import endpoint", async () => {
    api.importCalendar.mockResolvedValue({
      ...externalCalendar,
      id: "imported",
      imported: 1,
      name: "Imported",
    });
    const { hook } = setup();

    await act(async () => {
      await hook.result.current.importCalendar({
        accountId: "google-work",
        color: "#7A8BA3",
        ics: "BEGIN:VCALENDAR\nEND:VCALENDAR",
        name: "Imported",
        provider: "google",
      });
    });

    expect(api.importCalendar).toHaveBeenCalledWith(
      "BEGIN:VCALENDAR\nEND:VCALENDAR",
      "Imported",
      "#7A8BA3",
      "google",
      "google-work",
    );
  });
});
