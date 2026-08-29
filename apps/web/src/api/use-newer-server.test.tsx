import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import musubiPackage from "../../../../package.json";
import { getServerOrigin } from "./query-keys";
import { useNewerServer } from "./use-newer-server";

// The version this bundle was built from — the same constant the hook compares
// against. Read rather than hardcoded, so the suite does not need touching every
// release.
const BUILD = musubiPackage.version;

/** A version `steps` releases away from the build, in either direction. */
function offset(steps: number) {
  const [major, minor, patch] = BUILD.split(".").map(Number);
  return `${major}.${minor}.${patch + steps}`;
}

const getServerCapabilities = vi.fn();
vi.mock("./resources", () => ({
  getServerCapabilities: (...args: unknown[]) => getServerCapabilities(...args),
}));

/**
 * Render the hook against a server reporting `version`.
 *
 * `settled` is what makes the negative cases mean anything: the hook returns
 * null while the query is still in flight, so asserting null the moment the
 * fetch was *called* would pass no matter what the hook decided. Every
 * assertion below waits for the answer to be in the cache first.
 */
function served(version: string | undefined) {
  getServerCapabilities.mockResolvedValue(version === undefined ? {} : { version });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const queryKey = ["server-capabilities", getServerOrigin()];
  return {
    ...renderHook(() => useNewerServer(), { wrapper }),
    settled: () =>
      waitFor(() => expect(client.getQueryData(queryKey)).toBeDefined()),
  };
}

beforeEach(() => {
  sessionStorage.clear();
  getServerCapabilities.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("useNewerServer", () => {
  it("offers a reload once the server has moved ahead of this tab", async () => {
    const ahead = offset(1);
    const { result } = served(ahead);

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.version).toBe(ahead);
  });

  // The self-hosting case, and the reason this is not `!==`. Someone installs
  // today's web app in front of the server they set up last spring; there is no
  // newer bundle to fetch, so a reload prompt would be an unfixable nag.
  it("stays quiet when the server is behind the tab", async () => {
    const { result, settled } = served(offset(-1));

    await settled();
    expect(result.current).toBeNull();
  });

  it("stays quiet when the server matches the tab", async () => {
    const { result, settled } = served(BUILD);

    await settled();
    expect(result.current).toBeNull();
  });

  it("stays quiet when the server names no version", async () => {
    const { result, settled } = served(undefined);

    await settled();
    expect(result.current).toBeNull();
  });

  // A release lands API first and web second, so between the two deploys the tab
  // can see a newer server while the assets it would reload into are still the
  // old ones. Asking again straight after a reload that could not have helped
  // reads as a broken app.
  it("asks only once per server version", async () => {
    const ahead = offset(1);
    sessionStorage.setItem("musubi-reloaded-for", ahead);

    const { result, settled } = served(ahead);
    await settled();
    expect(result.current).toBeNull();
  });

  it("records the version it reloaded for before reloading", async () => {
    const ahead = offset(1);
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      reload,
    } as Location);

    const { result } = served(ahead);
    await waitFor(() => expect(result.current).not.toBeNull());
    result.current?.reload();

    expect(sessionStorage.getItem("musubi-reloaded-for")).toBe(ahead);
    expect(reload).toHaveBeenCalled();
  });

  // "0.1.10" sorts before "0.1.9" as a string, which would leave every tab on a
  // two-digit patch release quietly running old code.
  it("compares versions numerically, not as strings", async () => {
    const [major, minor] = BUILD.split(".").map(Number);
    const { result } = served(`${major}.${minor + 1}.10`);

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.version).toBe(`${major}.${minor + 1}.10`);
  });
});
