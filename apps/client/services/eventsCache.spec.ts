import { afterAll, expect, it, vi } from "vitest";
import { EventSchema, requireEventRevision } from "@musubi/types";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import migrations from "@/drizzle/migrations";

vi.mock("expo-sqlite", async () => {
  const { sqlitePlatform } = await import("@/test/sqlitePlatform");
  const sqlite = sqlitePlatform();
  return { openDatabaseSync: () => sqlite };
});
const { db, sqlite } = await import("./db");
const { cacheGetAllEvents, cacheUpsertEvents, cacheReplaceAllEvents } = await import("./eventsCache");
afterAll(() => (sqlite as unknown as { database: { close(): void } }).database.close());

const event = EventSchema.parse({ description: null, location: null, recurrence: null, url: null, id: "event", isAllDay: false, isCanceled: false, revision: 7, creatorID: "owner", organizer: "owner", title: "Original", color: "#7A8BA3", start: "2026-09-01T09:00:00Z", end: "2026-09-01T10:00:00Z", calendars: ["calendar"], originCalendarID: "calendar" });

it("migrates existing SQLite rows without inventing authority and round trips proven API revision through both cache writers", async () => {
  await migrate(db, { ...migrations, journal: { ...migrations.journal, entries: migrations.journal.entries.slice(0, 7) } });
  // Existing cache bytes from the actually generated pre-revision schema.
  db.run(`INSERT INTO events (id, creatorID, title, color, start, end, organizer, calendars) VALUES ('old', 'owner', 'Keep old text', '#7A8BA3', '2026-09-01T09:00:00Z', '2026-09-01T10:00:00Z', 'owner', '["calendar"]')`);
  await migrate(db, migrations);
  await migrate(db, migrations); // bootstrap rerun is idempotent
  const [old] = await cacheGetAllEvents();
  expect(old.title).toBe("Keep old text");
  expect(old.revision).toBeUndefined();
  expect(() => EventSchema.parse(old)).not.toThrow();
  expect(() => requireEventRevision(old)).toThrow("revision is unavailable");
  await cacheUpsertEvents([event]);
  expect((await cacheGetAllEvents()).find(e => e.id === event.id)).toEqual(event);
  await cacheReplaceAllEvents([event]);
  expect(await cacheGetAllEvents()).toEqual([event]);
  for (const write of [cacheUpsertEvents, cacheReplaceAllEvents]) {
    await cacheReplaceAllEvents([]);
    await cacheUpsertEvents([event]);
    for (const revision of [undefined, 3]) {
      await write([{ ...event, title: "Stale", revision }]);
      expect(await cacheGetAllEvents()).toEqual([event]);
    }
    await write([{ ...event, revision: 8, title: "Newer" }]);
    expect(await cacheGetAllEvents()).toEqual([{ ...event, revision: 8, title: "Newer" }]);
  }
});

it("orders duplicate batch revisions and synchronous cache deletion before a newer revival", async () => {
  const { cacheDeleteEvents } = await import("./eventsCache");
  await cacheReplaceAllEvents([]);
  await cacheUpsertEvents([{ ...event, revision: 9 }, { ...event, revision: undefined }, { ...event, revision: 4 }]);
  expect((await cacheGetAllEvents())[0].revision).toBe(9);
  const removing = cacheDeleteEvents([event.id]);
  const reviving = cacheUpsertEvents([{ ...event, revision: 10 }]);
  await Promise.all([removing, reviving]);
  expect((await cacheGetAllEvents())[0].revision).toBe(10);
});

it("failed full-cache insertion rolls back the actual SQLite transaction without losing existing rows", async () => {
  const before = await cacheGetAllEvents();
  db.run(`CREATE TRIGGER reject_cache_insert BEFORE INSERT ON events WHEN NEW.title = 'Reject' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`);
  await expect(cacheReplaceAllEvents([{ ...event, id: "rejected", title: "Reject" }])).rejects.toThrow();
  expect(await cacheGetAllEvents()).toEqual(before);
  db.run(`DROP TRIGGER reject_cache_insert`);
});
