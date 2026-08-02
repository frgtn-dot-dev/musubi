import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for IndexedDB: jsdom has none, and the value of these tests is the
// round trip through a store, not the browser's implementation of one.
const records = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  clear: async () => void records.clear(),
  createStore: () => undefined,
  del: async (key: string) => void records.delete(key),
  get: async (key: string) => records.get(key),
  set: async (key: string, value: unknown) => void records.set(key, value),
}));

const { clearAllSnapshots, createSnapshotPersister } = await import(
  "./persister"
);

const ORIGIN = "https://musubi.pro";

const eventsPayload = {
  deletedIds: [],
  events: [
    {
      calendars: ["work"],
      color: "#b3492f",
      creatorID: "user-1",
      end: new Date("2026-07-20T10:00:00Z"),
      hasAttendees: false,
      id: "standup",
      isAllDay: false,
      isCanceled: false,
      organizer: "a@b.c",
      recurrence: null,
      start: new Date("2026-07-20T09:00:00Z"),
      title: "Standup",
    },
  ],
  serverTime: "2026-07-20T09:00:00.000Z",
};

function persisterFor(userId: string, maxAgeMs?: number) {
  const queryClient = new QueryClient();
  return {
    persister: createSnapshotPersister({
      maxAgeMs,
      origin: ORIGIN,
      queryClient,
      userId,
    }),
    queryClient,
  };
}

/** The persister writes on a timer; this is the wait for that write to land. */
async function flushWrites() {
  await vi.advanceTimersByTimeAsync(1_100);
}

describe("createSnapshotPersister", () => {
  beforeEach(() => {
    records.clear();
    vi.useFakeTimers();
  });

  it("brings a calendar back with its dates intact", async () => {
    const first = persisterFor("user-1");
    first.queryClient.setQueryData(["events", ORIGIN, "user-1"], eventsPayload);
    first.persister.subscribe();
    await flushWrites();

    // A new tab: a fresh client that has never fetched anything.
    const second = persisterFor("user-1");
    const result = await second.persister.restore();

    expect(result.restored).toBe(true);
    expect(result.savedAt).toBeTypeOf("number");
    const restored = second.queryClient.getQueryData([
      "events",
      ORIGIN,
      "user-1",
    ]) as typeof eventsPayload;
    // JSON has no date type; without revival this is a string and every
    // getTime() in the calendar throws.
    expect(restored.events[0]!.start).toBeInstanceOf(Date);
    expect(restored.events[0]!.title).toBe("Standup");
  });

  it("does not hand one account's calendar to another", async () => {
    const mine = persisterFor("user-1");
    mine.queryClient.setQueryData(["events", ORIGIN, "user-1"], eventsPayload);
    mine.persister.subscribe();
    await flushWrites();

    const theirs = persisterFor("user-2");
    expect((await theirs.persister.restore()).restored).toBe(false);
    expect(theirs.queryClient.getQueryData(["events", ORIGIN, "user-1"])).toBeUndefined();
  });

  it("refuses a snapshot older than its own age limit, and forgets it", async () => {
    const first = persisterFor("user-1", 10_000);
    first.queryClient.setQueryData(["events", ORIGIN, "user-1"], eventsPayload);
    first.persister.subscribe();
    await flushWrites();
    expect(records.size).toBe(1);

    vi.setSystemTime(Date.now() + 20_000);
    const second = persisterFor("user-1", 10_000);

    expect((await second.persister.restore()).restored).toBe(false);
    // Left in place it would be read again on every start, and never be right.
    expect(records.size).toBe(0);
  });

  it("writes nothing while restoring, so a read cannot echo back as a write", async () => {
    const first = persisterFor("user-1");
    first.queryClient.setQueryData(["events", ORIGIN, "user-1"], eventsPayload);
    first.persister.subscribe();
    await flushWrites();
    const written = records.get([...records.keys()][0]!) as { savedAt: number };

    const second = persisterFor("user-1");
    await second.persister.restore();
    await flushWrites();

    const after = records.get([...records.keys()][0]!) as { savedAt: number };
    expect(after.savedAt).toBe(written.savedAt);
  });

  it("stops writing once removed", async () => {
    const { persister, queryClient } = persisterFor("user-1");
    queryClient.setQueryData(["events", ORIGIN, "user-1"], eventsPayload);
    persister.subscribe();
    await flushWrites();

    await persister.remove();
    expect(records.size).toBe(0);

    queryClient.setQueryData(["pages", ORIGIN, "user-1"], []);
    await flushWrites();
    expect(records.size).toBe(0);
  });

  it("clears every account's snapshot, not just the one signing out", async () => {
    for (const userId of ["user-1", "user-2"]) {
      const { persister, queryClient } = persisterFor(userId);
      queryClient.setQueryData(["pages", ORIGIN, userId], []);
      persister.subscribe();
      await flushWrites();
      persister.stop();
    }
    expect(records.size).toBe(2);

    await clearAllSnapshots();

    expect(records.size).toBe(0);
  });

  it("survives a store that refuses to write", async () => {
    const { persister, queryClient } = persisterFor("user-1");
    persister.subscribe();
    // A full or blocked database must not take the calendar down with it.
    const failing = new Map();
    Object.defineProperty(failing, "set", {
      value: () => {
        throw new Error("QuotaExceededError");
      },
    });
    queryClient.setQueryData(["pages", ORIGIN, "user-1"], []);

    await expect(flushWrites()).resolves.not.toThrow();
  });
});
