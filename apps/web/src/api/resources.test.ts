import { afterEach, expect, it, vi } from "vitest";
import { getEvents } from "./resources";

afterEach(() => vi.unstubAllGlobals());

function response() {
  return new Response(JSON.stringify({
    deletedIds: [],
    events: [],
    serverTime: "2026-07-01T00:00:00.000Z",
  }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

it("requests only the active event range", async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    void input;
    return response();
  });
  vi.stubGlobal("fetch", fetch);

  await getEvents({
    start: new Date("2026-07-01T00:00:00.000Z"),
    end: new Date("2026-08-01T00:00:00.000Z"),
  });

  expect(fetch.mock.calls[0]?.[0]).toBe(
    "/api/v1/events?start=2026-07-01T00%3A00%3A00.000Z&end=2026-08-01T00%3A00%3A00.000Z",
  );
});

it("keeps the compatibility full event read available", async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    void input;
    return response();
  });
  vi.stubGlobal("fetch", fetch);

  await getEvents();

  expect(fetch.mock.calls[0]?.[0]).toBe("/api/v1/events");
});
