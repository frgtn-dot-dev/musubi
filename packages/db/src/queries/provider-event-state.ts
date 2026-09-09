import { readProviderRsvpInstance } from "./provider-rsvp-instance";
import { providerStateVersion } from "./provider-reminders";
import { and, eq, isNull } from "drizzle-orm";
import { GoogleReminderWriteSchema, ProviderEventStateSchema, type ProviderEventStateResponse } from "@musubi/types";
import { db } from "..";
import { calendarEvents, calendarMembers, events, externalCalendars, externalEvents } from "../schema";

/** The connected account's own source copy only. Provider responses/reminders
 * are personal evidence and must not leak through another member's calendar. */
export async function getOwnProviderEventObservation(actorID: string, eventID: string, reminderEditsEnabled = false, rsvpEditsEnabled = false): Promise<ProviderEventStateResponse> {
  const [row] = await db.select({ mapping: externalEvents, externalCalendarID: externalCalendars.externalCalendarID, id: externalEvents.id, etag: externalEvents.etag, providerState: externalEvents.providerState, role: calendarMembers.role, event: events }).from(externalEvents)
    .innerJoin(events, and(eq(events.id, externalEvents.eventID), eq(events.originCalendarID, externalEvents.calendarID), isNull(events.deletedAt)))
    .innerJoin(calendarEvents, and(eq(calendarEvents.eventID, events.id), eq(calendarEvents.calendarID, externalEvents.calendarID)))
    .innerJoin(calendarMembers, and(eq(calendarMembers.calendarID, calendarEvents.calendarID), eq(calendarMembers.userID, actorID)))
    .innerJoin(externalCalendars, and(eq(externalCalendars.calendarID, externalEvents.calendarID), eq(externalCalendars.provider, externalEvents.provider), eq(externalCalendars.userID, actorID), eq(externalCalendars.externalCalendarID, externalEvents.externalCalendarID), eq(externalCalendars.disabled, false), eq(externalCalendars.supportsEvents, true)))
    .where(eq(events.id, eventID));
  if (!row?.providerState) return { state: null, version: null };
  const state = ProviderEventStateSchema.parse(row.providerState);
  const event = row.event;
  const reminders = state.reminders.provider === "google" ? GoogleReminderWriteSchema.safeParse(state.reminders.useDefault === true ? { useDefault: true } : { useDefault: state.reminders.useDefault, overrides: state.reminders.overrides }) : undefined;
  // Advertises a supported queue contract, never a fresh provider write grant.
  // The queue and worker still recheck source, state, pending work and permission.
  const editable = reminderEditsEnabled && state.provider === "google" && reminders?.success && ["owner", "editor"].includes(row.role) && !!row.etag && !row.etag.startsWith("W/") && event.timeModel?.kind !== "floating" && !event.recurrence && !event.seriesID && !event.originalStart && !event.isCanceled;
  const self = state.attendees.filter(item => item.self === true);
  const rsvpEligible = rsvpEditsEnabled && state.provider === "google" && ["owner", "editor"].includes(row.role) && !!row.etag && !row.etag.startsWith("W/") && event.timeModel?.kind !== "floating" && !event.recurrence && !event.isCanceled && state.attendeesComplete && state.attendees.length <= 200 && self.length === 1 && !!self[0]!.address && self[0]!.address.toLowerCase() === row.externalCalendarID.toLowerCase() && state.isOrganizer !== true && !!state.organizer?.address && state.organizer.address.toLowerCase() !== row.externalCalendarID.toLowerCase() && ["confirmed", "tentative"].includes(state.status ?? "") && [null, "default"].includes(state.eventType);
  let rsvpScope = !event.seriesID && !event.originalStart && !row.mapping.externalSeriesID && !row.mapping.originalStart;
  if (rsvpEligible && !rsvpScope) {
    try { rsvpScope = !!(await readProviderRsvpInstance(db, event, row.mapping, actorID)); }
    catch { rsvpScope = false; }
  }
  const rsvpEditable = rsvpEligible && rsvpScope;
  return { state, version: providerStateVersion(row), ...(rsvpEditable ? { rsvpEdit: { provider: "google" as const, expectedRevision: event.revision } } : {}), ...(editable ? { reminderEdit: { provider: "google" as const, expectedRevision: event.revision } } : {}) };

}

export async function getOwnProviderEventState(actorID: string, eventID: string) {
  return (await getOwnProviderEventObservation(actorID, eventID)).state;
}
