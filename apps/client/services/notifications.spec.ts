import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import migrations from "@/drizzle/migrations";
import { EventSchema, occurrenceKey } from "@musubi/types";
import type { CachedEvent } from "./eventsCache";

const os = vi.hoisted(() => ({
  next: 0,
  pending: new Map<
    string,
    { content: { data: { eventID: string } }; trigger: { date: Date } }
  >(),
  gate: null as null | (() => Promise<void>),
}));
vi.mock("expo-sqlite", async () => {
  const { sqlitePlatform } = await import("@/test/sqlitePlatform");
  const handle = sqlitePlatform();
  return { openDatabaseSync: () => handle };
});
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/lib/timezone", () => ({ deviceTimezone: () => "UTC" }));
vi.mock("@/store/useSettingsStore", () => ({
  useSettingsStore: { getState: () => ({ calendarOrder: [] }) },
}));
vi.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date" },
  setNotificationHandler: vi.fn(),
  setNotificationCategoryAsync: vi.fn(async () => {}),
  scheduleNotificationAsync: vi.fn(async (request) => {
    const id = `notification-${++os.next}`;
    os.pending.set(id, request);
    if (os.gate) await os.gate();
    return id;
  }),
  cancelScheduledNotificationAsync: vi.fn(async (id) => {
    os.pending.delete(id);
  }),
  cancelAllScheduledNotificationsAsync: vi.fn(async () => {
    os.pending.clear();
  }),
  getAllScheduledNotificationsAsync: vi.fn(async () =>
    [...os.pending.keys()].map((identifier) => ({ identifier })),
  ),
}));
const { db, sqlite } = await import("./db");
const { notificationsTable } = await import("@/db/schema");
const { cacheReplaceAllEvents, cacheUpsertEvents } =
  await import("./eventsCache");
const {
  syncScheduledReminders,
  clearAllEventNotifications,
  cancelEventNotification,
  storeReminderRules,
  setReminderWriter,
  setEventReminderRule,
  setCalendarReminderRule,
  effectiveReminderRule,
  inheritedReminderRule,
  loadCachedReminderRules,
  reminderRules,
} = await import("./notifications");
const series: CachedEvent = {
  ...EventSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    creatorID: "owner",
    organizer: "owner",
    title: "Series",
    color: "red",
    start: "2026-01-02T09:00:00Z",
    end: "2026-01-02T10:00:00Z",
    calendars: ["calendar"],
    isAllDay: false,
    isCanceled: false,
    revision: 20,
    recurrence: "FREQ=DAILY;COUNT=2",
  }),
  timeModel: {
    kind: "zoned",
    timeZone: "UTC",
    startLocal: "2026-01-02T09:00:00.000",
    endLocal: "2026-01-02T10:00:00.000",
  },
};
const detached: CachedEvent = {
  ...series,
  id: "00000000-0000-4000-8000-000000000002",
  seriesID: series.id,
  originalStart: { kind: "instant", value: "2026-01-02T09:00:00.000Z" },
  recurrence: null,
};
const rules = {
  default: { minutesBefore: 10, allDay: null },
  calendars: {},
  events: {},
};
beforeAll(async () => {
  await migrate(db, migrations);
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  await cacheReplaceAllEvents([]);
  await storeReminderRules(rules);
});
afterEach(async () => {
  await clearAllEventNotifications();
  os.gate = null;
  vi.useRealTimers();
});
afterAll(() => {
  (sqlite as unknown as { database: { close(): void } }).database.close();
});

it("updates OS navigation when an unchanged original slot acquires a detached UUID", async () => {
  await cacheReplaceAllEvents([series]);
  await syncScheduledReminders([series]);
  const key = occurrenceKey({
    seriesId: series.id,
    originalStart: detached.originalStart!,
  });
  const before = (await db.select().from(notificationsTable)).find(
    (row) => row.occurrenceID === key,
  )!;
  await cacheUpsertEvents([detached]);
  await syncScheduledReminders([detached], { onlyEventIDs: [detached.id] });
  const rows = await db.select().from(notificationsTable);
  const after = rows.find((row) => row.occurrenceID === key)!;
  expect(rows).toHaveLength(2);
  expect(after.eventID).toBe(detached.id);
  expect(after.identifier).not.toBe(before.identifier);
  expect(os.pending.has(before.identifier)).toBe(false);
  expect(os.pending.get(after.identifier)?.content.data.eventID).toBe(
    detached.id,
  );
});

it("retains cancellation siblings in a scoped series refresh and leaves other receipts alone", async () => {
  const canceled = { ...detached, isCanceled: true };
  const unrelated = {
    ...series,
    id: "unrelated",
    recurrence: null,
    timeModel: undefined,
  };
  await cacheReplaceAllEvents([series, canceled, unrelated]);
  await syncScheduledReminders([series, canceled, unrelated]);
  const before = (await db.select().from(notificationsTable)).find(
    (row) => row.eventID === unrelated.id,
  )!;
  await syncScheduledReminders([series], { onlyEventIDs: [series.id] });
  const rows = await db.select().from(notificationsTable);
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.eventID === unrelated.id)?.identifier).toBe(
    before.identifier,
  );
  expect(
    rows.some(
      (row) =>
        row.occurrenceID ===
        occurrenceKey({
          seriesId: series.id,
          originalStart: detached.originalStart!,
        }),
    ),
  ).toBe(false);
});

function blockFirstSchedule() {
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  os.gate = async () => {
    os.gate = null;
    started();
    await wait;
  };
  return { entered, release };
}

it("serializes overlapping passes so the newer due time wins", async () => {
  const first = { ...series, recurrence: null };
  const later = {
    ...first,
    revision: 21,
    start: new Date("2026-01-02T11:00:00Z"),
    end: new Date("2026-01-02T12:00:00Z"),
    timeModel: {
      kind: "zoned" as const,
      timeZone: "UTC",
      startLocal: "2026-01-02T11:00:00.000",
      endLocal: "2026-01-02T12:00:00.000",
    },
  };
  const gate = blockFirstSchedule();
  const a = syncScheduledReminders([first]);
  await gate.entered;
  const b = syncScheduledReminders([later]);
  gate.release();
  await Promise.all([a, b]);
  const rows = await db.select().from(notificationsTable);
  expect(rows).toHaveLength(1);
  expect(rows[0].triggerDate).toBe("2026-01-02T10:50:00.000Z");
  expect(os.pending.size).toBe(1);
});

it("cancellation queued behind an in-flight schedule removes its receipt and OS notification", async () => {
  const gate = blockFirstSchedule();
  const sync = syncScheduledReminders([{ ...series, recurrence: null }]);
  await gate.entered;
  const canceled = cancelEventNotification(series.id);
  gate.release();
  await Promise.all([sync, canceled]);
  expect(await db.select().from(notificationsTable)).toEqual([]);
  expect(os.pending.size).toBe(0);
});

it("sign-out invalidates pending snapshots and cancels an in-flight OS write", async () => {
  const gate = blockFirstSchedule();
  const sync = syncScheduledReminders([{ ...series, recurrence: null }]);
  await gate.entered;
  const queued = syncScheduledReminders([series]);
  const cleared = clearAllEventNotifications();
  gate.release();
  await Promise.all([sync, queued, cleared]);
  expect(await db.select().from(notificationsTable)).toEqual([]);
  expect(os.pending.size).toBe(0);
  await storeReminderRules(rules);
  await syncScheduledReminders([{ ...series, recurrence: null }]);
  expect(os.pending.size).toBe(1);
});

it(" deleted detached receipt must not block restored original slot", async () => {
  await cacheReplaceAllEvents([series, detached]);
  await syncScheduledReminders([series, detached]);
  const unrelated = {
    ...series,
    id: "unrelated",
    recurrence: null,
    timeModel: undefined,
  };
  const gate = blockFirstSchedule();
  const busy = syncScheduledReminders([unrelated], {
    onlyEventIDs: [unrelated.id],
  });
  await gate.entered;
  const refresh = syncScheduledReminders([series], {
    onlyEventIDs: [series.id],
  });
  const { cacheDeleteEvents } = await import("@/services/eventsCache");
  await cacheDeleteEvents([detached.id]);
  const removed = cancelEventNotification(detached.id);
  gate.release();
  await Promise.all([busy, refresh, removed]);
  const rows = await db.select().from(notificationsTable);
  const key = occurrenceKey({
    seriesId: series.id,
    originalStart: detached.originalStart!,
  });
  expect(rows.find((row) => row.occurrenceID === key)?.eventID).toBe(series.id);
});

for (const scope of ["event", "calendar"] as const) {
  it(`ignores a ${scope} rule response from before sign-out`, async () => {
    let release!: () => void;
    setReminderWriter(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const changed =
      scope === "event"
        ? setEventReminderRule(series, { minutesBefore: 30, allDay: null })
        : setCalendarReminderRule(
            "calendar",
            { minutesBefore: 30, allDay: null },
            [series],
          );
    await clearAllEventNotifications();
    await storeReminderRules(rules);
    release();
    await changed;
    expect(await db.select().from(notificationsTable)).toEqual([]);
    expect(effectiveReminderRule(series)).toEqual(rules.default);
  });
}

it("form helpers retain the master override when a detached override is cleared", async () => {
  const masterRule = { minutesBefore: 30, allDay: null };
  const ownRule = { minutesBefore: 60, allDay: null };
  await storeReminderRules({
    ...rules,
    events: { [series.id]: masterRule, [detached.id]: ownRule },
  });
  expect(effectiveReminderRule(detached)).toEqual(ownRule);
  expect(inheritedReminderRule(detached)).toEqual(masterRule);
  expect(inheritedReminderRule(series)).toEqual(rules.default);
});

it("does not restore cached rules after sign-out or overwrite a newer server answer", async () => {
  const cache = await import("./eventsCache");
  await clearAllEventNotifications();
  let release!: (value: typeof rules) => void;
  const read = vi.spyOn(cache, "cacheGetReminders").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  try {
    const loading = loadCachedReminderRules();
    await clearAllEventNotifications();
    release(rules);
    expect(await loading).toBeNull();
    expect(reminderRules()).toBeNull();
    const next = loadCachedReminderRules();
    const fresh = { ...rules, default: { minutesBefore: 60, allDay: null } };
    await storeReminderRules(fresh);
    release(rules);
    expect(await next).toEqual(fresh);
  } finally {
    read.mockRestore();
  }
});
