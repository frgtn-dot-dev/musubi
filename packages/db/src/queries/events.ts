import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "..";
import {
  type NewEvent,
  calendarEvents,
  calendarMembers,
  eventUsers,
  events,
  user,
} from "../schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function createEventInTransaction(
  tx: Transaction,
  event: NewEvent,
  calendars: string[],
) {
  // Home calendar = where it's created (first picked). Edit-content is gated by
  // editEvents on this calendar; the other picked calendars are read-only shares.
  const [result] = await tx
    .insert(events)
    .values({
      ...event,
      originCalendarID: event.originCalendarID ?? calendars[0],
    })
    .onConflictDoNothing()
    .returning();
  if (!result) throw new Error(`Event ${event.id} already exists.`);

  await tx.insert(eventUsers).values({
    userID: result.creatorID,
    eventID: result.id,
  });
  await tx
    .insert(calendarEvents)
    .values(calendars.map((c) => ({ calendarID: c, eventID: result.id })))
    .onConflictDoNothing({
      target: [calendarEvents.eventID, calendarEvents.calendarID],
    });
  return result;
}

export function createEvent(event: NewEvent, calendars: string[]) {
  return db.transaction((tx) => createEventInTransaction(tx, event, calendars));
}

// Who governs editing this event's shared content: its home calendar (+ creator
// as legacy fallback when origin is null). Used by assertCanEditEvent.
export async function getEventOrigin(
  eventID: string,
): Promise<{ originCalendarID: string | null; creatorID: string } | undefined> {
  const [row] = await db
    .select({
      originCalendarID: events.originCalendarID,
      creatorID: events.creatorID,
    })
    .from(events)
    .where(eq(events.id, eventID));
  return row;
}

// Calendars an event is currently linked to (from calendar_events). Used to diff
// against the incoming set on update → add/remove links + push to providers.
export async function getEventCalendars(eventID: string): Promise<string[]> {
  const rows = await db
    .select({ calendarID: calendarEvents.calendarID })
    .from(calendarEvents)
    .where(eq(calendarEvents.eventID, eventID));
  return rows.map((r) => r.calendarID);
}

export async function getEvent(id: string) {
  const [result] = await db.select().from(events).where(eq(events.id, id));
  return result;
}

export async function updateEvent(event: Partial<NewEvent> & { id: string }) {
  const [result] = await db
    .update(events)
    .set(event)
    .where(eq(events.id, event.id!))
    .returning();
  return result;
}

export async function getUsersEvents(
  userID: string,
  { since, start, end }: { since?: Date; start?: Date; end?: Date } = {},
) {
  // Delta reads include tombstones. Range reads keep every recurring master so
  // occurrence expansion remains client-side, plus one-offs overlapping the window.
  const eventFilter = since
    ? gt(events.updatedAt, since)
    : and(
        isNull(events.deletedAt),
        start && end
          ? or(
              isNotNull(events.recurrence),
              and(lt(events.start, end), gt(events.end, start)),
            )
          : undefined,
      );

  return db
    .select({ event: events, calendarID: calendarEvents.calendarID })
    .from(calendarMembers)
    .innerJoin(
      calendarEvents,
      eq(calendarEvents.calendarID, calendarMembers.calendarID),
    )
    .innerJoin(events, eq(events.id, calendarEvents.eventID))
    .where(and(eq(calendarMembers.userID, userID), eventFilter));
}

// Attendees: name + avatar only — no emails (an event can span calendars whose
// members aren't mutuals, so don't leak what the UI doesn't need).
export type AttendanceStatus = "declined" | "going" | "maybe";

// The database orders the list, so web and mobile cannot hold two versions of
// what "first" means.
const STATUS_RANK = sql`CASE ${eventUsers.status}
  WHEN 'going' THEN 0 WHEN 'maybe' THEN 1 ELSE 2 END`;

export async function getEventAttendees(eventID: string) {
  const rows = await db
    .select({
      id: user.id,
      image: user.image,
      name: user.name,
      status: eventUsers.status,
    })
    .from(eventUsers)
    .innerJoin(user, eq(user.id, eventUsers.userID))
    .where(eq(eventUsers.eventID, eventID))
    .orderBy(STATUS_RANK, user.name);

  return rows as Array<{
    id: string;
    image: string | null;
    name: string;
    status: AttendanceStatus;
  }>;
}

// Idempotent answer — the unique (event, user) constraint absorbs retries.
// "none" is the answer withdrawn, which is the absence of a row.
export async function setAttendance(
  eventID: string,
  userID: string,
  status: AttendanceStatus | "none",
) {
  if (status === "none") {
    await db
      .delete(eventUsers)
      .where(
        and(eq(eventUsers.eventID, eventID), eq(eventUsers.userID, userID)),
      );
    return;
  }

  await db
    .insert(eventUsers)
    .values({ eventID, status, userID })
    .onConflictDoUpdate({
      set: { status, updatedAt: new Date() },
      target: [eventUsers.eventID, eventUsers.userID],
    });
}

// Publishing a page collects answers, so the event's attendee section has to be
// on. Set by the share handler rather than asked of the organizer twice.
export async function setEventHasAttendees(
  eventID: string,
  hasAttendees: boolean,
) {
  await db.update(events).set({ hasAttendees }).where(eq(events.id, eventID));
}

// Hard-delete tombstones older than `before` (cascades their calendarEvents +
// externalEvents mappings). Clients that haven't synced in that long won't see
// the removal, but that window is intentionally generous.
export async function purgeDeletedEvents(before: Date) {
  await db
    .delete(events)
    .where(and(isNotNull(events.deletedAt), lt(events.deletedAt, before)));
}

export async function removeEvent(eventID: string) {
  // Soft-delete: keep the row as a tombstone so delta sync can tell clients to
  // drop it. Bumps updatedAt via $onUpdate → picked up by `since` queries.
  const [result] = await db
    .update(events)
    .set({ deletedAt: new Date() })
    .where(eq(events.id, eventID))
    .returning();

  return result;
}
