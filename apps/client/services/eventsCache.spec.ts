import { afterAll, expect, it, vi } from "vitest";
import { EventSchema, requireEventRevision } from "@musubi/types";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import migrations from "@/drizzle/migrations";
import type { CachedEvent } from "./eventsCache";
import { expandRecurringEvents } from "@musubi/calendar";

vi.mock("expo-sqlite", async () => {
  const { sqlitePlatform } = await import("@/test/sqlitePlatform");
  const sqlite = sqlitePlatform();
  return { openDatabaseSync: () => sqlite };
});
const { db, sqlite } = await import("./db");
const { cacheGetAllEvents, cacheUpsertEvents, cacheReplaceAllEvents } =
  await import("./eventsCache");
afterAll(() =>
  (sqlite as unknown as { database: { close(): void } }).database.close(),
);

const event = EventSchema.parse({
  description: null,
  location: null,
  recurrence: null,
  url: null,
  id: "event",
  isAllDay: false,
  isCanceled: false,
  revision: 7,
  creatorID: "owner",
  organizer: "owner",
  title: "Original",
  color: "#7A8BA3",
  start: "2026-09-01T09:00:00Z",
  end: "2026-09-01T10:00:00Z",
  calendars: ["calendar"],
  originCalendarID: "calendar",
});

it("migrates existing SQLite rows without inventing authority and round trips proven API revision through both cache writers", async () => {
  await migrate(db, {
    ...migrations,
    journal: {
      ...migrations.journal,
      entries: migrations.journal.entries.slice(0, 7),
    },
  });
  // Existing cache bytes from the actually generated pre-revision schema.
  db.run(
    `INSERT INTO events (id, creatorID, title, color, start, end, organizer, calendars) VALUES ('old', 'owner', 'Keep old text', '#7A8BA3', '2026-09-01T09:00:00Z', '2026-09-01T10:00:00Z', 'owner', '["calendar"]')`,
  );
  await migrate(db, {
    ...migrations,
    journal: {
      ...migrations.journal,
      entries: migrations.journal.entries.slice(0, 8),
    },
  });
  db.run(
    `INSERT INTO events (id, revision, creatorID, title, color, start, end, organizer, calendars) VALUES ('proven', 7, 'owner', 'Keep revision', '#7A8BA3', '2026-09-01T09:00:00Z', '2026-09-01T10:00:00Z', 'owner', '["calendar"]')`,
  );
  const beforeProven = sqlite.getFirstSync(
    "SELECT * FROM events WHERE id = 'proven'",
  );
  const beforeTimeMigration = sqlite.getFirstSync(
    "SELECT * FROM events WHERE id = 'old'",
  );
  await migrate(db, migrations);
  await migrate(db, migrations); // bootstrap rerun is idempotent
  const { timeModel, seriesID, originalStart, ...afterTimeMigration } =
    sqlite.getFirstSync<Record<string, unknown>>(
      "SELECT * FROM events WHERE id = 'old'",
    )!;
  expect(afterTimeMigration).toEqual(beforeTimeMigration);
  expect([timeModel, seriesID, originalStart]).toEqual([null, null, null]);
  const {
    timeModel: provenModel,
    seriesID: provenSeries,
    originalStart: provenOriginal,
    ...afterProven
  } = sqlite.getFirstSync<Record<string, unknown>>(
    "SELECT * FROM events WHERE id = 'proven'",
  )!;
  expect(afterProven).toEqual(beforeProven);
  expect(afterProven.revision).toBe(7);
  expect([provenModel, provenSeries, provenOriginal]).toEqual([
    null,
    null,
    null,
  ]);
  const [old] = await cacheGetAllEvents();
  expect(old.title).toBe("Keep old text");
  expect(old.revision).toBeUndefined();
  expect(() => EventSchema.parse(old)).not.toThrow();
  expect(() => requireEventRevision(old)).toThrow("revision is unavailable");
  await cacheUpsertEvents([event]);
  expect((await cacheGetAllEvents()).find((e) => e.id === event.id)).toEqual(
    event,
  );
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
    expect(await cacheGetAllEvents()).toEqual([
      { ...event, revision: 8, title: "Newer" },
    ]);
  }
});

it("orders duplicate batch revisions and synchronous cache deletion before a newer revival", async () => {
  const { cacheDeleteEvents } = await import("./eventsCache");
  await cacheReplaceAllEvents([]);
  await cacheUpsertEvents([
    { ...event, revision: 9 },
    { ...event, revision: undefined },
    { ...event, revision: 4 },
  ]);
  expect((await cacheGetAllEvents())[0].revision).toBe(9);
  const removing = cacheDeleteEvents([event.id]);
  const reviving = cacheUpsertEvents([{ ...event, revision: 10 }]);
  await Promise.all([removing, reviving]);
  expect((await cacheGetAllEvents())[0].revision).toBe(10);
});

it("failed full-cache insertion rolls back the actual SQLite transaction without losing existing rows", async () => {
  const before = await cacheGetAllEvents();
  db.run(
    `CREATE TRIGGER reject_cache_insert BEFORE INSERT ON events WHEN NEW.title = 'Reject' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`,
  );
  await expect(
    cacheReplaceAllEvents([{ ...event, id: "rejected", title: "Reject" }]),
  ).rejects.toThrow();
  expect(await cacheGetAllEvents()).toEqual(before);
  db.run(`DROP TRIGGER reject_cache_insert`);
});

it("preserves canonical time metadata and moved identity across SQLite reads and both cache writers", async () => {
  const series: CachedEvent = {
    ...event,
    id: "00000000-0000-4000-8000-000000000001",
    revision: 20,
    start: new Date("2026-03-28T01:30:00Z"),
    end: new Date("2026-03-28T02:30:00Z"),
    recurrence: "FREQ=DAILY;COUNT=3",
    timeModel: {
      kind: "zoned",
      timeZone: "Europe/Prague",
      startLocal: "2026-03-28T02:30:00.000",
      endLocal: "2026-03-28T03:30:00.000",
    },
  };
  const moved: CachedEvent = {
    ...event,
    id: "00000000-0000-4000-8000-000000000002",
    revision: 20,
    start: new Date("2026-04-02T10:00:00Z"),
    end: new Date("2026-04-02T11:00:00Z"),
    timeModel: {
      kind: "zoned",
      timeZone: "Europe/Prague",
      startLocal: "2026-04-02T12:00:00.000",
      endLocal: "2026-04-02T13:00:00.000",
    },
    seriesID: series.id,
    originalStart: { kind: "instant", value: "2026-03-30T00:30:00.000Z" },
  };
  const from = new Date("2026-03-01Z"),
    to = new Date("2026-04-10Z");
  for (const write of [cacheUpsertEvents, cacheReplaceAllEvents]) {
    await cacheReplaceAllEvents([]);
    await write([series, moved]);
    const loaded = await cacheGetAllEvents();
    expect(loaded).toEqual([series, moved]);
    expect(loaded[1].originalStart).not.toBe(moved.originalStart);
    expect(
      expandRecurringEvents(loaded, from, to, {
        consumerTimeZone: "America/New_York",
      }),
    ).toEqual(
      expandRecurringEvents([series, moved], from, to, {
        consumerTimeZone: "UTC",
      }),
    );
    await write([
      { ...series, revision: 19, timeModel: null },
      {
        ...moved,
        revision: 19,
        seriesID: null,
        originalStart: null,
        timeModel: null,
      },
    ]);
    expect(await cacheGetAllEvents()).toEqual([series, moved]);
    await write([
      { ...series, timeModel: undefined },
      {
        ...moved,
        timeModel: undefined,
        seriesID: undefined,
        originalStart: undefined,
      },
    ]);
    expect(await cacheGetAllEvents()).toEqual([series, moved]);
    await write([series, { ...moved, timeModel: undefined }]);
    expect(await cacheGetAllEvents()).toEqual([series, moved]);
    const before = await cacheGetAllEvents();
    await expect(
      write([
        { ...series, revision: 21 },
        { ...moved, revision: 21, originalStart: null },
      ]),
    ).rejects.toThrow();
    expect(await cacheGetAllEvents()).toEqual(before);
    const floating: CachedEvent = {
      ...series,
      revision: 21,
      timeModel: {
        kind: "floating",
        startLocal: "2026-03-28T02:30:00.000",
        endLocal: "2026-03-28T03:30:00.000",
      },
    };
    const allDay: CachedEvent = {
      ...moved,
      revision: 21,
      seriesID: null,
      originalStart: null,
      isAllDay: true,
      start: new Date("2026-04-02Z"),
      end: new Date("2026-04-02Z"),
      timeModel: { kind: "all-day" },
    };
    await write([floating, allDay]);
    const results = await cacheGetAllEvents();
    expect(results[0].timeModel).toEqual(floating.timeModel);
    expect(results[1].timeModel).toEqual({ kind: "all-day" });
    expect(results[1].seriesID).toBeUndefined();
    expect(results[1].originalStart).toBeUndefined();
  }
});

it("does not reinterpret corrupt saved time metadata as legacy", async () => {
  db.run(
    "UPDATE events SET timeModel = '{broken' WHERE id = '00000000-0000-4000-8000-000000000001'",
  );
  await expect(cacheGetAllEvents()).rejects.toThrow();
  await cacheReplaceAllEvents([]);
});
