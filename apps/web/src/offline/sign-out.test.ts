import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const order: string[] = [];

vi.mock("~/api/realtime", () => ({
  closeRealtimeStream: () => order.push("close-stream"),
}));
vi.mock("~/auth/auth-client", () => ({
  authClient: {
    signOut: () => {
      order.push("sign-out");
      return Promise.resolve();
    },
  },
}));
vi.mock("./persister", () => ({
  clearAllSnapshots: () => {
    order.push("clear-snapshot");
    return Promise.resolve();
  },
}));
vi.mock("./session-marker", () => ({
  clearSessionMarker: () => order.push("clear-marker"),
}));

const { signOutAndReset } = await import("./sign-out");

describe("signOutAndReset", () => {
  beforeEach(() => {
    order.length = 0;
  });

  it("leaves nothing local behind before it releases the session", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["calendars"], [{ id: "cal-1" }]);
    const onDone = vi.fn(() => order.push("navigate"));

    await signOutAndReset({ onDone, queryClient });

    // The stream goes first — still open, it answers the next server nudge by
    // refetching into the cache we are about to empty. Navigation is last, so
    // the login screen cannot paint over data that is still in memory.
    expect(order).toEqual([
      "close-stream",
      "clear-snapshot",
      "clear-marker",
      "sign-out",
      "navigate",
    ]);
    expect(queryClient.getQueryData(["calendars"])).toBeUndefined();
  });

  it("still wipes the machine when the server cannot be told", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["events"], [{ id: "event-1" }]);
    const { authClient } = await import("~/auth/auth-client");
    vi.spyOn(authClient, "signOut").mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );

    // Signing out offline must not throw and must not leave the calendar in
    // memory: the cookie dies on the server's next look, the data dies now.
    await expect(signOutAndReset({ queryClient })).resolves.toBeUndefined();
    expect(queryClient.getQueryData(["events"])).toBeUndefined();
    expect(order).toContain("clear-snapshot");
  });
});
