import { and, eq, isNull } from "drizzle-orm";
import { ProviderEventStateSchema } from "@musubi/types";
import { db } from "..";
import { calendarEvents, calendarMembers, events, externalCalendars, externalEvents } from "../schema";

/** The connected account's own source copy only. Provider responses/reminders
 * are personal evidence and must not leak through another member's calendar. */
export async function getOwnProviderEventState(actorID: string, eventID: string) {
  const [row] = await db.select({ state: externalEvents.providerState }).from(externalEvents)
    .innerJoin(events, and(eq(events.id, externalEvents.eventID), eq(events.originCalendarID, externalEvents.calendarID), isNull(events.deletedAt)))
    .innerJoin(calendarEvents, and(eq(calendarEvents.eventID, events.id), eq(calendarEvents.calendarID, externalEvents.calendarID)))
    .innerJoin(calendarMembers, and(eq(calendarMembers.calendarID, calendarEvents.calendarID), eq(calendarMembers.userID, actorID)))
    .innerJoin(externalCalendars, and(eq(externalCalendars.calendarID, externalEvents.calendarID), eq(externalCalendars.provider, externalEvents.provider), eq(externalCalendars.userID, actorID), eq(externalCalendars.externalCalendarID, externalEvents.externalCalendarID), eq(externalCalendars.disabled, false), eq(externalCalendars.supportsEvents, true)))
    .where(eq(events.id, eventID));
  return row?.state ? ProviderEventStateSchema.parse(row.state) : null;
}
