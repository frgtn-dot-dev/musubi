import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

// What this device has actually handed to the OS. Not the configuration —
// that lives on the server now and roams between devices; this table is the
// executor's receipt, so a reconcile can tell what to cancel and what to leave
// alone. One row per OCCURRENCE: a daily standup schedules many, and keying by
// event would mean a series only ever reminded once per app launch.
export const notificationsTable = sqliteTable("notifications_table", {
  id: int().primaryKey({ autoIncrement: true }),
  identifier: text().notNull(),
  // `${eventID}_${occurrenceStartMs}` — what resolveReminders() mints.
  occurrenceID: text().notNull().unique(),
  eventID: text().notNull(),
  triggerDate: text().notNull(),
});

// Local cache of events (full mirror). Dates stored as ISO text; calendars as
// a JSON string[]. Booleans as int (0/1).
export const eventsTable = sqliteTable("events", {
  id: text().primaryKey(),
  creatorID: text().notNull(),
  title: text().notNull(),
  color: text().notNull(),
  start: text().notNull(),
  end: text().notNull(),
  isAllDay: int({ mode: "boolean" }).notNull().default(false),
  description: text(),
  location: text(),
  isCanceled: int({ mode: "boolean" }).notNull().default(false),
  hasAttendees: int({ mode: "boolean" }).notNull().default(false),
  organizer: text().notNull(),
  recurrence: text(),
  url: text(),
  calendars: text().notNull(), // JSON string[]
  originCalendarID: text(),
});

// key/value for sync bookkeeping (e.g. lastSync = server time of last delta).
export const syncMetaTable = sqliteTable("sync_meta", {
  key: text().primaryKey(),
  value: text().notNull(),
});
