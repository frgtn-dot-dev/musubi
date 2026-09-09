import { markGooglePersonalReadRedaction } from "./google-personal-read-recovery";
import { and, eq, inArray, sql } from "drizzle-orm";
import { calendarEvents, calendars, events, externalEvents, pendingNotifications } from "../schema";
import type { DbTransaction } from "./calendars";

/** Under the source calendar's exclusive lifecycle fence. Keep native identity,
 * temporal meaning and private pending intents; retire only the readable mirror.
 * Refresh must establish what the narrower native grant still allows reading. */
export async function redactGoogleCalendarMirror(tx: DbTransaction, calendarID: string, userID: string, sourceID: string, provider: "google" | "microsoft" = "google") {
  const [calendar] = await tx.select({ color: calendars.color }).from(calendars).where(eq(calendars.id, calendarID));
  if (!calendar) throw new Error("Calendar access source changed.");
  const rows = await tx.select().from(events).where(and(eq(events.originCalendarID, calendarID), eq(events.creatorID, userID), sql`exists (select 1 from ${externalEvents} where (${externalEvents.eventID} = ${events.id} or (${provider} = 'microsoft' and ${externalEvents.eventID} = ${events.seriesID})) and ${externalEvents.calendarID} = ${calendarID} and ${externalEvents.provider} = ${provider})`)).orderBy(events.id).for("update");
  if (!rows.length) return [calendarID];
  if (provider === "google") for (const row of rows) await markGooglePersonalReadRedaction(tx, row, sourceID);
  const ids = rows.map(row => row.id);
  const links = await tx.select({ calendarID: calendarEvents.calendarID }).from(calendarEvents).where(inArray(calendarEvents.eventID, ids));
  await tx.update(events).set({ providerReadRetiredRevision: sql`greatest(coalesce(${events.providerReadRetiredRevision}, 0), ${events.revision} + 1)`, title: "Busy", description: null, location: null, organizer: "", url: null, color: calendar.color, revision: sql`${events.revision} + 1` }).where(inArray(events.id, ids));
  // Invalidating the validator also forces a same-ETag fresh observation through
  // normal import. A saved outbox baseline is never a source of restoration.
  await tx.update(externalEvents).set({ etag: null, providerState: null, providerStateObservedAt: null, readRedactionRevision: sql`(select ${events.revision} from ${events} where ${events.id} = ${externalEvents.eventID})` }).where(and(eq(externalEvents.provider, provider), eq(externalEvents.calendarID, calendarID), inArray(externalEvents.eventID, ids)));
  await tx.delete(pendingNotifications).where(and(eq(pendingNotifications.kind, "event_changed"), inArray(pendingNotifications.subjectID, ids)));
  return [...new Set([calendarID, ...links.map(link => link.calendarID)])];
}
