import { randomUUID } from "node:crypto";
import { expandRecurringEvents, resolveEventTimeEdit } from "@musubi/calendar";
import { BadRequestError, EventSchema, EventTimeCreateRequestSchema, EventWriteError, can, hasKnownEventTime, type Event } from "@musubi/types";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "..";
import { calendarEvents, calendarMembers, events, externalCalendars, externalEvents, eventOutbox } from "../schema";
import { lockCalendarLifecycle } from "./calendar-lifecycle";
import { createEventInTransaction } from "./events";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function localTargets(tx: Tx, ids: string[]) {
  if (ids.length && (await tx.select({ id: externalCalendars.id }).from(externalCalendars)
    .where(inArray(externalCalendars.calendarID, ids)).limit(1)).length)
    throw new BadRequestError("This operation requires a time-model-aware provider write. No changes were saved.");
}
async function grants(tx: Tx, ids: string[], actorID: string) {
  return tx.select({ id: calendarMembers.calendarID, role: calendarMembers.role }).from(calendarMembers)
    .where(and(eq(calendarMembers.userID, actorID), inArray(calendarMembers.calendarID, ids)))
    .orderBy(calendarMembers.calendarID).for("share");
}
function validate(event: Event) {
  try {
    expandRecurringEvents([{ ...event, isCanceled: false }], event.start, event.end, { consumerTimeZone: "UTC" });
  } catch {
    throw new BadRequestError("The requested time or recurrence is invalid or unsupported. No changes were saved.");
  }
}

/** Calendar lifecycle and membership locks protect admission through commit. */
export async function createLocalEventWithTime(input: unknown, actorID: string) {
  const request = EventTimeCreateRequestSchema.parse(input);
  const ids = [...new Set(request.event.calendars)];
  const originCalendarID = request.event.originCalendarID ?? ids[0];
  if (!ids.includes(originCalendarID)) throw new BadRequestError("originCalendarID must be one of the event's calendars.");
  return db.transaction(async tx => {
    await lockCalendarLifecycle(tx, ids, "shared");
    const memberships = await grants(tx, ids, actorID);
    if (!ids.every(id => memberships.some(m => m.id === id && can(m.role, "editEvents"))))
      throw new EventWriteError("event-write", "denied");
    await localTargets(tx, ids);
    let time: ReturnType<typeof resolveEventTimeEdit>;
    try { time = resolveEventTimeEdit(request.time); }
    catch { throw new BadRequestError("The requested time is invalid. No changes were saved."); }
    const event = { ...request.event, ...time, creatorID: actorID, organizer: actorID, originCalendarID, calendars: ids };
    validate(event);
    const saved = await createEventInTransaction(tx, event, ids);
    return { ...saved, calendars: ids };
  });
}

/** A copy retains the exact stored instant, including a second DST fold. */
export async function forkLocalEventWithTimeAtRevision(eventID: string, expectedRevision: number, calendarID: string, actorID: string) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new TypeError("A positive expected event revision is required");
  return db.transaction(async tx => {
    const [discovered] = await tx.select().from(events).where(eq(events.id, eventID));
    if (!discovered) return { status: "not_found" as const };
    const initial = await tx.select({ id: calendarEvents.calendarID }).from(calendarEvents).where(eq(calendarEvents.eventID, eventID));
    const fenced = [...new Set([calendarID, ...initial.map(x => x.id), ...(discovered.originCalendarID ? [discovered.originCalendarID] : [])])];
    await lockCalendarLifecycle(tx, fenced, "shared");
    const [source] = await tx.select().from(events).where(eq(events.id, eventID)).for("update");
    if (!source) return { status: "not_found" as const };
    const links = await tx.select({ id: calendarEvents.calendarID }).from(calendarEvents).where(eq(calendarEvents.eventID, eventID));
    const ids = links.map(x => x.id);
    const current = { ...source, calendars: ids };
    const memberships = await grants(tx, fenced, actorID);
    if (!memberships.some(m => ids.includes(m.id)) || !memberships.some(m => m.id === calendarID && can(m.role, "editEvents")))
      throw new EventWriteError("event-write", "denied");
    if (source.revision !== expectedRevision || source.deletedAt || source.originCalendarID !== discovered.originCalendarID || ids.some(id => !fenced.includes(id)))
      return { status: "conflict" as const, current };
    if (ids.includes(calendarID)) throw new BadRequestError("This event is already in that calendar.");
    const [child] = await tx.select({ id: events.id }).from(events).where(eq(events.seriesID, eventID)).limit(1);
    if (!hasKnownEventTime(source) || source.seriesID || source.originalStart || child)
      throw new BadRequestError("This copy requires an occurrence-aware operation. No changes were saved.");
    await localTargets(tx, fenced);
    const [mapping] = await tx.select({ id: externalEvents.id }).from(externalEvents).where(eq(externalEvents.eventID, eventID)).limit(1);
    const [history] = await tx.select({ id: eventOutbox.id }).from(eventOutbox).where(eq(eventOutbox.eventID, eventID)).limit(1);
    if (mapping || history) throw new BadRequestError("This copy requires a time-model-aware provider write. No changes were saved.");
    const event = { ...EventSchema.parse(current), id: randomUUID(), creatorID: actorID, organizer: actorID, originCalendarID: calendarID, calendars: [calendarID], isCanceled: false };
    validate(event);
    const saved = await createEventInTransaction(tx, event, [calendarID]);
    return { status: "saved" as const, event: { ...saved, calendars: [calendarID] } };
  });
}
