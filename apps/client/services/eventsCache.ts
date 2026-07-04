import { eq, inArray } from "drizzle-orm";
import { Event } from "@musubi/types";
import { db } from "./db";
import { eventsTable, syncMetaTable } from "@/db/schema";

// Event <-> SQLite row. Dates as ISO text (new Date() accepts Date or string),
// calendars as JSON. Read back as real Date objects.
function toRow(e: Event) {
  return {
    id: e.id,
    creatorID: e.creatorID,
    title: e.title,
    color: e.color,
    start: new Date(e.start).toISOString(),
    end: new Date(e.end).toISOString(),
    isAllDay: e.isAllDay,
    description: e.description ?? null,
    location: e.location ?? null,
    isCanceled: e.isCanceled ?? false,
    organizer: e.organizer,
    recurrence: e.recurrence ?? null,
    url: e.url ?? null,
    calendars: JSON.stringify(e.calendars ?? []),
  };
}

function fromRow(r: typeof eventsTable.$inferSelect): Event {
  return {
    id: r.id,
    creatorID: r.creatorID,
    title: r.title,
    color: r.color,
    start: new Date(r.start),
    end: new Date(r.end),
    isAllDay: r.isAllDay,
    description: r.description,
    location: r.location,
    isCanceled: r.isCanceled,
    organizer: r.organizer,
    recurrence: r.recurrence,
    url: r.url,
    calendars: JSON.parse(r.calendars),
  } as Event;
}

export async function cacheGetAllEvents(): Promise<Event[]> {
  const rows = await db.select().from(eventsTable);
  return rows.map(fromRow);
}

export async function cacheUpsertEvents(events: Event[]) {
  if (!events.length) return;
  // delete-then-insert = upsert without excluded gymnastics
  await db.delete(eventsTable).where(inArray(eventsTable.id, events.map((e) => e.id)));
  const rows = events.map(toRow);
  // chunk to stay under SQLite's bound-variable limit on big first syncs
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(eventsTable).values(rows.slice(i, i + 200));
  }
}

export async function cacheDeleteEvents(ids: string[]) {
  if (!ids.length) return;
  await db.delete(eventsTable).where(inArray(eventsTable.id, ids));
}

export async function getLastSync(): Promise<string | null> {
  const [row] = await db.select().from(syncMetaTable).where(eq(syncMetaTable.key, "lastSync"));
  return row?.value ?? null;
}

export async function setLastSync(iso: string) {
  await db.insert(syncMetaTable)
    .values({ key: "lastSync", value: iso })
    .onConflictDoUpdate({ target: syncMetaTable.key, set: { value: iso } });
}
