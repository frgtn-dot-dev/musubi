import { beforeEach, expect, it, vi } from "vitest";
import type { OutlookMoveOptions, OutlookMoveResult } from "@musubi/types";
import { OutlookMoveSession } from "./outlookMoveSession";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const options: OutlookMoveOptions = { eventID: id(1), calendarID: id(2), version: "a".repeat(64), title: "Weekly walk", meeting: true, timeZone: "Asia/Kathmandu", preserved: { edited: 1, cancelled: 1, unavailable: 2 }, occurrences: Array.from({ length: 22 }, (_, n) => ({ eventID: id(10 + n), start: `2026-10-${String(n + 1).padStart(2, "0")}T12:00:00Z`, end: `2026-10-${String(n + 1).padStart(2, "0")}T13:00:00Z` })) };
const preview: OutlookMoveResult = { operationID: id(3), eventID: id(1), title: options.title, meeting: true, timeZone: options.timeZone, expiresAt: "2099-01-01T00:00:00Z", offsetMinutes: 30, status: "preview", items: [{ ...options.occurrences[0], newStart: "2026-10-01T12:30:00Z", newEnd: "2026-10-01T13:30:00Z", status: "pending" }] };
const running: OutlookMoveResult = { ...preview, status: "running", items: [{ ...preview.items[0], status: "queued" }] };
const deferred = <T>() => { let resolve!: (v: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const api = { getLatestOutlookMove: vi.fn(), getOutlookMoveOptions: vi.fn(), getOutlookMove: vi.fn(), previewOutlookMove: vi.fn(), startOutlookMove: vi.fn() };
let session: OutlookMoveSession;
beforeEach(() => {
  vi.resetAllMocks();
  api.getLatestOutlookMove.mockResolvedValue(null); api.getOutlookMoveOptions.mockResolvedValue(options);
  api.previewOutlookMove.mockResolvedValue(preview); api.startOutlookMove.mockResolvedValue(running);
  api.getOutlookMove.mockResolvedValue(running);
  session = new OutlookMoveSession(api, id(1), () => id(3));
});
it("requires an exact preview and explicit confirmation; duplicate taps never start twice", async () => {
  await session.start(); await session.confirm(); expect(api.startOutlookMove).not.toHaveBeenCalled();
  await session.preview([id(10)], 30);
  expect(api.previewOutlookMove).toHaveBeenCalledWith({ operationID: id(3), eventID: id(1), calendarID: id(2), expectedVersion: options.version, eventIDs: [id(10)], offsetMinutes: 30 }, expect.any(AbortSignal));
  expect(api.startOutlookMove).not.toHaveBeenCalled();
  const pending = deferred<OutlookMoveResult>(); api.startOutlookMove.mockReturnValueOnce(pending.promise);
  const starting = session.confirm(); await session.confirm(); pending.resolve(running); await starting;
  expect(api.startOutlookMove).toHaveBeenCalledTimes(1); expect(session.state.result).toEqual(running);
});
it.each([0, 721, -721, 0.5, NaN])("refuses invalid shift %s before a request", async minutes => {
  await session.start(); await session.preview([id(10)], minutes); expect(api.previewOutlookMove).not.toHaveBeenCalled(); expect(session.state.error).toBeTruthy();
});
it.each([[], [id(10), id(10)], [id(999)], options.occurrences.slice(0, 21).map(item => item.eventID)].map(selected => ({ selected })))("validates the selected set", async ({ selected }) => {
  await session.start(); await session.preview(selected, 30); expect(api.previewOutlookMove).not.toHaveBeenCalled();
});
it("freezes a preview after a lost response and retries its same UUID and body", async () => {
  api.previewOutlookMove.mockRejectedValueOnce(new Error("offline")); await session.start();
  const selected = [id(10)]; await session.preview(selected, -30); selected.push(id(11));
  expect(session.state.options).toBeUndefined(); await session.refresh();
  await session.preview([id(12)], 60);
  expect(api.previewOutlookMove.mock.calls[0][0]).toEqual(api.previewOutlookMove.mock.calls[1][0]);
  expect(api.previewOutlookMove.mock.calls[1][0]).toMatchObject({ eventIDs: [id(10)], offsetMinutes: -30 });
});
it.each([preview, running, { ...running, status: "completed" }, { ...running, status: "stopped" }])("reopens a persisted $status operation without any write", async result => {
  api.getLatestOutlookMove.mockResolvedValue(result); await session.start();
  expect(session.state.result).toEqual(result); expect(api.getOutlookMoveOptions).not.toHaveBeenCalled();
  expect(api.previewOutlookMove).not.toHaveBeenCalled(); expect(api.startOutlookMove).not.toHaveBeenCalled();
});
it("does not start an expired preview", async () => {
  api.getLatestOutlookMove.mockResolvedValue({ ...preview, expiresAt: "2020-01-01T00:00:00Z" });
  await session.start(); await session.confirm(); expect(api.startOutlookMove).not.toHaveBeenCalled(); expect(session.state.error).toMatch(/expired/);
});
it("coalesces revision refreshes during start and rejects its now-stale response", async () => {
  api.getLatestOutlookMove.mockResolvedValue(preview); await session.start();
  const pending = deferred<OutlookMoveResult>(); api.startOutlookMove.mockReturnValue(pending.promise);
  const starting = session.confirm(); await session.refresh(); await session.refresh();
  expect(session.state.result).toBeUndefined(); expect(session.state.phase).toBe("loading");
  api.getLatestOutlookMove.mockRejectedValue(new Error("access revoked")); pending.resolve(running); await starting;
  expect(session.state.result).toBeUndefined(); expect(session.state.phase).toBe("error"); expect(api.getLatestOutlookMove).toHaveBeenCalledTimes(2);
});
it("serializes progress reads and recovers from a transient failure without another start", async () => {
  api.getLatestOutlookMove.mockResolvedValue(running); await session.start();
  const pending = deferred<OutlookMoveResult>(); api.getOutlookMove.mockReturnValueOnce(pending.promise);
  const polling = session.poll(); await session.poll(); expect(api.getOutlookMove).toHaveBeenCalledTimes(1);
  pending.reject(new Error("offline")); await polling; expect(session.state.result).toBeUndefined();
  await session.poll(); expect(session.state.result).toEqual(running); expect(api.startOutlookMove).not.toHaveBeenCalled();
});
it("clears dates in the background, aborts reads, and refreshes before allowing action on return", async () => {
  api.getLatestOutlookMove.mockResolvedValue(running); await session.start();
  const pending = deferred<OutlookMoveResult>(); api.getOutlookMove.mockReturnValueOnce(pending.promise);
  const polling = session.poll(); session.suspend();
  expect(api.getOutlookMove.mock.calls[0][1].aborted).toBe(true); expect(session.state.result).toBeUndefined();
  pending.resolve(running); await polling; await session.poll(); expect(api.getOutlookMove).toHaveBeenCalledTimes(1);
  await session.resume(); expect(session.state.result).toEqual(running); expect(api.startOutlookMove).not.toHaveBeenCalled();
});
it("ignores an older read after a revision refresh, even if transport ignores abort", async () => {
  const pending = deferred<OutlookMoveResult | null>(); api.getLatestOutlookMove.mockReturnValueOnce(pending.promise);
  const first = session.start(); api.getLatestOutlookMove.mockResolvedValue(running); await session.refresh();
  pending.resolve(preview); await first; expect(session.state.result).toEqual(running);
});
it("prevents late account responses from restoring disposed content", async () => {
  const pending = deferred<OutlookMoveResult | null>(); api.getLatestOutlookMove.mockReturnValueOnce(pending.promise);
  const opening = session.start(); session.dispose(); pending.resolve(preview); await opening;
  expect(session.state.result).toBeUndefined(); await session.confirm(); expect(api.startOutlookMove).not.toHaveBeenCalled();
});
it("shows partial statuses and blocks a new preview until unconfirmed work resolves", async () => {
  const stopped: OutlookMoveResult = { ...running, status: "stopped", items: ["completed", "unconfirmed", "not-started"].map((status, index) => ({ ...running.items[0], eventID: id(10 + index), status: status as OutlookMoveResult["items"][number]["status"] })) };
  api.getLatestOutlookMove.mockResolvedValue(stopped); await session.start(); await session.changeSelection();
  expect(api.getOutlookMoveOptions).not.toHaveBeenCalled(); expect(session.state.result).toEqual(stopped);
  api.getLatestOutlookMove.mockResolvedValue({ ...stopped, items: stopped.items.map(item => ({ ...item, status: "completed" })) });
  await session.refresh(); await session.changeSelection(); expect(session.state.options).toEqual(options);
});
it("rejects mismatched result identities", async () => {
  api.getLatestOutlookMove.mockResolvedValue({ ...preview, eventID: id(99) }); await session.start(); expect(session.state.phase).toBe("error"); expect(session.state.result).toBeUndefined();
});
it("recovers a lost start response by reading the journal", async () => {
  api.getLatestOutlookMove.mockResolvedValue(preview); await session.start(); api.startOutlookMove.mockRejectedValue(new Error("timeout"));
  await session.confirm(); api.getLatestOutlookMove.mockResolvedValue(running); await session.refresh();
  expect(session.state.result).toEqual(running); expect(api.startOutlookMove).toHaveBeenCalledTimes(1);
});
it("notifies mounted controls after the write lock releases", async () => {
  await session.start();
  const observed: boolean[] = []; session.subscribe(() => observed.push(session.busy));
  await session.preview([id(10)], 30);
  expect(observed).toContain(true); expect(observed.at(-1)).toBe(false);
});
it("revalidates after backgrounding during a write without dispatching again", async () => {
  api.getLatestOutlookMove.mockResolvedValue(preview); await session.start();
  const pending = deferred<OutlookMoveResult>(); api.startOutlookMove.mockReturnValue(pending.promise);
  const starting = session.confirm(); session.suspend(); await session.resume();
  expect(session.state.result).toBeUndefined(); api.getLatestOutlookMove.mockResolvedValue(running);
  pending.resolve(running); await starting;
  expect(session.state.result).toEqual(running); expect(api.startOutlookMove).toHaveBeenCalledTimes(1);
});
