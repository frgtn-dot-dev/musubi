import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray } from "drizzle-orm";
import { BadRequestError, EventSchema, type Event } from "@musubi/types";
import { db } from "..";
import { calendarEvents, calendarMembers, events, externalCalendars, eventOutbox } from "../schema";
import { lockCalendarLifecycle, lockUserLifecycle } from "./calendar-lifecycle";

function comparable(input: Event) {
  const event = EventSchema.parse(input);
  return { ...event, id: event.id.toLowerCase(), revision: 1,
    calendars: [...new Set(event.calendars.map(id => id.toLowerCase()))].sort(),
    originCalendarID: (event.originCalendarID ?? event.calendars[0])?.toLowerCase(),
    description: event.description ?? null, location: event.location ?? null,
    recurrence: event.recurrence ?? null, url: event.url ?? null,
    timeModel: event.timeModel ?? null, seriesID: event.seriesID ?? null, originalStart: event.originalStart ?? null,
  };
}

/** Reconcile an existing creation UUID, without appending history or delivering
 * again. A current matching event is sufficient; changed content is a conflict,
 * not proof that the old request itself was replayed. No historical snapshots
 * are promoted to current readable state. */
export async function readEventCreateReceipt(actorID: string, input: Event) {
  const expected = comparable({ ...input, creatorID: actorID });
  return db.transaction(async tx => {
    await lockUserLifecycle(tx, [actorID], "shared");
    const [initial] = await tx.select().from(events).where(eq(events.id, expected.id));
    if (!initial) return { kind: "missing" as const };
    if (initial.creatorID !== actorID) throw new BadRequestError("This creation identity is unavailable. No changes were saved.");
    const initialLinks = await tx.select().from(calendarEvents).where(eq(calendarEvents.eventID, expected.id));
    const fenced = [...new Set([...initialLinks.map(row => row.calendarID), ...(initial.originCalendarID ? [initial.originCalendarID] : [])])];
    await lockCalendarLifecycle(tx, fenced, "shared");
    const [current] = await tx.select().from(events).where(eq(events.id, expected.id)).for("share");
    const links = await tx.select().from(calendarEvents).where(eq(calendarEvents.eventID, expected.id)).for("share");
    if (!current || current.deletedAt || current.creatorID !== actorID || !current.originCalendarID || current.originCalendarID !== initial.originCalendarID || !links.length || links.some(row => !fenced.includes(row.calendarID)))
      return { kind: "unavailable" as const };
    const grants = await tx.select().from(calendarMembers).where(and(inArray(calendarMembers.calendarID, links.map(row => row.calendarID)), eq(calendarMembers.userID, actorID))).orderBy(calendarMembers.calendarID).for("share");
    const [source] = await tx.select().from(externalCalendars).where(eq(externalCalendars.calendarID, current.originCalendarID)).for("share");
    if (!grants.some(grant => ["owner", "editor", "viewer"].includes(grant.role)) || (source && (source.disabled || !source.supportsEvents))) return { kind: "unavailable" as const };
    const history = await tx.select({ payload: eventOutbox.payload }).from(eventOutbox).where(eq(eventOutbox.eventID, expected.id));
    if (history.some(row => row.payload.graphSeriesCreate)) throw new BadRequestError("This event identity already has provider history. No changes were saved.");
    const event = EventSchema.parse({ ...current, calendars: links.map(row => row.calendarID) });
    return { kind: isDeepStrictEqual(comparable(event), expected) ? "matching" as const : "changed" as const, event };
  });
}
