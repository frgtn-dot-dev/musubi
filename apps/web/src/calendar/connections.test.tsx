import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { rememberProviderLink, useProviderLinkReturn } from "./connections";

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
