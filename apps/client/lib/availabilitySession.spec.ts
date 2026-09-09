import { expect, it, vi } from "vitest";
import { AvailabilitySession, type AvailabilityClient } from "./availabilitySession";
const id = "00000000-0000-4000-8000-000000000001";
const source = (generation = 1, enabled = true) => ({ id, generation, enabled, label: "Work", accountLabel: "Google", reconnectRequired: false });
const result = (status: "available" | "unavailable" | "reconnect-required" = "available", generation = 1) => ({ start: "2026-10-25T00:00:00Z", end: "2026-10-26T00:00:00Z", observedAt: "2026-10-24T12:00:00Z", sources: [{ sourceId: id, generation, status, ...(status === "available" ? { intervals: [] } : {}) }] }) as Awaited<ReturnType<AvailabilityClient["getAvailability"]>>;
function fixture() {
  const api = { getAvailabilitySources: vi.fn(async () => ({ sources: [source()] })), selectAvailabilitySource: vi.fn(async () => ({ sources: [source(2, false)] })), getAvailability: vi.fn(async () => result()) };
  return { api, session: new AvailabilitySession(api) };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
it("replaces busy evidence with distinct unknown/reconnect/confirmed empty results", async () => {
  const { api, session } = fixture(); await session.start();
  for (const status of ["available", "unavailable", "reconnect-required"] as const) {
    api.getAvailability.mockResolvedValueOnce(result(status)); await session.read("2026-10-25", "2026-10-26");
    expect(session.state.result?.sources[0].status).toBe(status);
  }
  api.getAvailability.mockRejectedValueOnce(new Error("offline")); await session.read("2026-10-25", "2026-10-26");
  expect(session.state.result).toBeUndefined(); expect(session.state.error).toContain("No free time"); session.dispose();
});
it("aborts a source poll before saving a switch and ignores the stale reply", async () => {
  const { api, session } = fixture(); await session.start(); const old = deferred<{ sources: ReturnType<typeof source>[] }>();
  api.getAvailabilitySources.mockReturnValueOnce(old.promise); const poll = session.refresh();
  const signal = (api.getAvailabilitySources.mock.calls.at(-1) as unknown as [AbortSignal])[0];
  await session.select(id, false); expect(signal.aborted).toBe(true);
  old.resolve({ sources: [source()] }); await poll;
  expect(session.state.sources[0]).toMatchObject({ generation: 2, enabled: false }); session.dispose();
});
it("close, background and a new account cannot retain or accept old interval replies", async () => {
  const { api, session } = fixture(); await session.start(); const delayed = deferred<ReturnType<typeof result>>(); api.getAvailability.mockReturnValueOnce(delayed.promise);
  const reading = session.read("2026-10-25", "2026-10-26"); const signal = (api.getAvailability.mock.calls.at(-1) as unknown as [unknown, AbortSignal])[1];
  session.dispose(); const next = new AvailabilitySession(api); await next.start();
  delayed.resolve(result()); await reading;
  expect(signal.aborted).toBe(true); expect(session.state.result).toBeUndefined(); expect(next.state.result).toBeUndefined();
  await next.read("2026-10-25", "2026-10-26"); next.invalidate(); expect(next.state.sources).toEqual([]); expect(next.state.result).toBeUndefined(); next.dispose();
});
it("changed source generations are refreshed instead of showing old intervals", async () => {
  const { api, session } = fixture(); await session.start(); api.getAvailability.mockResolvedValueOnce(result("available", 2)); api.getAvailabilitySources.mockResolvedValueOnce({ sources: [source(2)] });
  await session.read("2026-10-25", "2026-10-26"); expect(session.state.result).toBeUndefined(); expect(session.state.sources[0].generation).toBe(2); expect(session.state.error).toContain("changed"); session.dispose();
});
it("rejects too many sources, allows disabling an existing excess selection, and guards dates", async () => {
  const { api, session } = fixture(); const sources = Array.from({ length: 22 }, (_, i) => ({ ...source(), id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, enabled: i < 21 }));
  api.getAvailabilitySources.mockResolvedValueOnce({ sources }); await session.start();
  await session.select(sources[21].id, true); expect(api.selectAvailabilitySource).not.toHaveBeenCalled(); expect(session.state.error).toContain("20");
  await session.read("2026-10-25", "2026-10-26"); expect(api.getAvailability).not.toHaveBeenCalled(); expect(session.state.error).toContain("20");
  await session.select(id, false); expect(api.selectAvailabilitySource).toHaveBeenCalledWith(id, false, 1, expect.any(AbortSignal));
  await session.read("2026-10-26", "2026-10-25"); expect(api.getAvailability).not.toHaveBeenCalled(); session.dispose();
});
it("refreshes a failed CAS before retrying with its new generation", async () => {
  const { api, session } = fixture(); await session.start(); api.selectAvailabilitySource.mockRejectedValueOnce(new Error("stale")); api.getAvailabilitySources.mockResolvedValueOnce({ sources: [source(3)] });
  await session.select(id, false); expect(session.state.sources[0].generation).toBe(3); expect(session.state.error).toContain("refreshed");
  await session.select(id, false); expect(api.selectAvailabilitySource).toHaveBeenLastCalledWith(id, false, 3, expect.any(AbortSignal)); session.dispose();
});
