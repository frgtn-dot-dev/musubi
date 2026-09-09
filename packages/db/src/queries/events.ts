import { appendEventOutbox, reserveEventMutation, type EventOutboxIntent } from "./event-outbox";
import { lockCalendarLifecycle } from "./calendar-lifecycle";
import { and, eq, gt, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "..";
import {
	type NewEvent,
	calendarEvents,
	calendarMembers,
	eventUsers,
	eventOutbox,
	events,
	user,
} from "../schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const EVENT_CONTENT_FIELDS = [
	"title", "color", "start", "end", "isAllDay", "description", "location",
	"isCanceled", "hasAttendees", "organizer", "recurrence", "url",
] as const;
export type EventContentPatch = Partial<Pick<NewEvent, (typeof EVENT_CONTENT_FIELDS)[number]>>;

/** Only modeled, explicitly supplied changes. Undefined is omission; null clears.
 * Dates compare by instant, recurrence lines by set, not transport spelling.
 */
export function diffEventContent(current: EventContentPatch, incoming: EventContentPatch,
): EventContentPatch {
	const diff: EventContentPatch = {};
	const comparable = (key: (typeof EVENT_CONTENT_FIELDS)[number], value: unknown,
	) => {
		if (value instanceof Date) return value.getTime();
		if (key === "recurrence") return typeof value === "string" && value
			? [...new Set(value.split("\n").filter(Boolean))].sort().join("\n") : null;
		return value ?? null;
	};
	for (const key of EVENT_CONTENT_FIELDS) {
		const value = incoming[key];
		if (value !== undefined && comparable(key, current[key]) !== comparable(key, value)) {
			Object.assign(diff, { [key]: value });
		}
	}
	return diff;
}

export async function createEventInTransaction(
	tx: Transaction,
	event: NewEvent,
	calendars: string[],
) {
	// Caller holds the complete lifecycle admission fence before any event lock.
	// Home calendar = where it's created (first picked). Edit-content is gated by
	// editEvents on this calendar; the other picked calendars are read-only shares.
	const [result] = await tx
		.insert(events)
		.values({
			...event,
			revision: 1, // New identity never inherits a draft/source revision.
			originCalendarID: event.originCalendarID ?? calendars[0],
		})
		.onConflictDoNothing({ target: events.id })
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

export function createEvent(event: NewEvent, calendars: string[], outbox: readonly EventOutboxIntent[] = []) {
	return db.transaction(async (tx) => {
		await lockCalendarLifecycle(tx, [...calendars, ...(event.originCalendarID ? [event.originCalendarID] : [])], "shared");
		await reserveEventMutation(tx, event.id!, outbox);
		const created = await createEventInTransaction(tx, event, calendars);
		await appendEventOutbox(tx, { ...created, calendars }, outbox);
		return created;
	});
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

/** Content and links from one PostgreSQL statement snapshot. */
export async function getEventSnapshot(id: string) {
  const row = await db.query.events.findFirst({
    where: eq(events.id, id),
    with: { calendarEvents: true },
  });
  if (!row) return undefined;
  const { calendarEvents: links, ...event } = row;
  return { ...event, calendars: links.map((link) => link.calendarID) };
}

export async function getEvent(id: string) {
	const [result] = await db.select().from(events).where(eq(events.id, id));
	return result;
}

export async function getUsersEvents(
	userID: string,
	{ since, start, end }: { since?: Date; start?: Date; end?: Date } = {},
) {
	// Delta reads include tombstones. Range reads keep every recurring master so
	// occurrence expansion remains client-side. Keep every visible exception too:
	// its moved dates may be outside the window while its original slot is inside.
	// Floating compatibility instants cannot determine overlap for another viewer.
	// All-day inclusive ends start at UTC midnight: floor the lower boundary
	// before offset padding so late-evening sub-day windows retain that date.
	const eventFilter = since
		? gt(events.updatedAt, since)
		: and(
				isNull(events.deletedAt),
				start && end
					? or(
							isNotNull(events.recurrence),
							isNotNull(events.seriesID),
							sql`${events.timeModel}->>'kind' = 'floating'`,
							and(eq(events.isAllDay, true),
								lt(events.start, new Date(end.getTime() + 86_400_000)),
								gte(events.end, new Date((Math.floor(start.getTime() / 86_400_000) - 1) * 86_400_000))),
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
			.where(and(eq(eventUsers.eventID, eventID), eq(eventUsers.userID, userID)));
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

// Hard-delete tombstones older than `before` (cascades their calendarEvents +
// externalEvents mappings). Clients that haven't synced in that long won't see
// the removal, but that window is intentionally generous.
export async function purgeDeletedEvents(before: Date) {
	await db
		.delete(events)
		.where(and(isNotNull(events.deletedAt), lt(events.deletedAt, before), sql`not exists (
      select 1 from ${eventOutbox}
      where ${eventOutbox.eventID} = coalesce(${events.seriesID}, ${events.id})
        and (${eventOutbox.payload}->'caldavSeriesDeletion' is not null or ${eventOutbox.payload}->'caldavSeries' is not null)
        and ${eventOutbox.status} not in ('completed', 'not-needed')
    )`));
}
