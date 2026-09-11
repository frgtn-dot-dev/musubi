import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { rememberProviderLink, useConnections, useProviderLinkReturn } from "./connections";

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

it.each([200, 400])("OAuth return sends the marked provider through the real resource and handles HTTP %i", async (status) => {
  const fetch = vi.fn(async () => new Response(status === 200 ? "OK" : JSON.stringify({ error: "Import failed" }), {
    status, headers: { "content-type": status === 200 ? "text/plain" : "application/json" },
  }));
  vi.stubGlobal("fetch", fetch);
  rememberProviderLink("microsoft");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, rerender } = renderHook(({ userId }) => useProviderLinkReturn(userId), { wrapper, initialProps: { userId: "anonymous" } });
  expect(fetch).not.toHaveBeenCalled();
  rerender({ userId: "owner" });
  await waitFor(() => expect(result.current.importing).toBe(false));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]).toEqual([
    "/api/v1/users/connections/sync",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ provider: "microsoft" }), credentials: "include" }),
  ]);
  expect(result.current.error).toBe(status === 200 ? undefined : "Import failed");
  rerender({ userId: "owner" });
  expect(fetch).toHaveBeenCalledTimes(1);
  client.clear();
});


it.each([200, 503])("manual refresh reconciles owner caches after HTTP %i and retires busy observations", async status => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const fetch = vi.fn(async () => {
    await gate;
    return new Response(status === 200 ? "OK" : JSON.stringify({ error: "Provider unavailable" }), {
      status, headers: { "content-type": status === 200 ? "text/plain" : "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const origin = window.location.origin;
  client.setQueryData(["server-capabilities", origin], { syncProviders: ["google"] });
  const ownerKeys = ["calendars", "events", "tasks"].map(kind => [kind, origin, "owner"]);
  for (const key of ownerKeys) client.setQueryData(key, ["old"]);
  const otherKey = ["calendars", origin, "other"];
  client.setQueryData(otherKey, ["untouched"]);
  const sourcesKey = ["availability", origin, "owner", "sources"];
  const intervalsKey = ["availability", origin, "owner", "intervals", "old"];
  client.setQueryData(sourcesKey, { sources: [] });
  client.setQueryData(intervalsKey, { sources: [{ status: "available" }] });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useConnections("owner"), { wrapper });
  let pending!: Promise<unknown>;
  act(() => { pending = result.current.refreshConnectedCalendars().catch(error => error); });
  await waitFor(() => expect(result.current.refreshing).toBe(true));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(client.getQueryData(intervalsKey)).toBeUndefined();
  expect(fetch.mock.calls[0]).toEqual([
    "/api/v1/users/connections/sync",
    expect.objectContaining({ method: "POST", body: "{}", credentials: "include" }),
  ]);
  await act(async () => { finish(); await pending; });
  await waitFor(() => expect(result.current.refreshing).toBe(false));
  for (const key of ownerKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryData(sourcesKey)).toBeUndefined();
  expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  client.clear();
});
