import { and, eq, sql } from "drizzle-orm";
import { db } from "..";
import { calendarMembers, externalCalendars } from "../schema";
import type { DbTransaction } from "./calendars";
import { lockCalendarLifecycle } from "./calendar-lifecycle";

export type GoogleCalendarAccessRole = "owner" | "writer" | "reader" | "writerWithoutPrivateAccess" | "unknown";
export type ExternalCalendarAccessContext = {
  linkID: string;
  revision: number;
  userID: string;
  accountID: string;
  externalCalendarID: string;
};

/** Local ordering of complete discovery observations, not a native ACL version. */
export async function reconcileGoogleCalendarAccess(userID: string, accountID: string, calendarID: string, accessRole: GoogleCalendarAccessRole) {
  if (!["owner", "writer", "reader", "writerWithoutPrivateAccess", "unknown"].includes(accessRole)) throw new Error("Invalid Google access role.");
  return db.transaction(async tx => {
    await lockCalendarLifecycle(tx, [calendarID], "exclusive");
    const [source] = await tx.select().from(externalCalendars).where(and(eq(externalCalendars.provider, "google"), eq(externalCalendars.userID, userID), eq(externalCalendars.accountID, accountID), eq(externalCalendars.calendarID, calendarID), eq(externalCalendars.disabled, false), eq(externalCalendars.supportsEvents, true))).for("update");
    if (!source) throw new Error("Calendar access source changed.");
    const [member] = await tx.select().from(calendarMembers).where(and(eq(calendarMembers.userID, userID), eq(calendarMembers.calendarID, calendarID))).for("update");
    if (!member) throw new Error("Calendar access membership changed.");
    const role = ["owner", "writer"].includes(accessRole) ? "owner" : "viewer";
    if (member.role !== role) await tx.update(calendarMembers).set({ role }).where(eq(calendarMembers.id, member.id));
    if (source.providerAccessRole === accessRole && member.role === role) return false;
    await tx.update(externalCalendars).set({ providerAccessRole: accessRole, providerAccessRevision: sql`${externalCalendars.providerAccessRevision} + 1`, cursor: null }).where(eq(externalCalendars.id, source.id));
    return true;
  });
}

/** Call after the calendar lifecycle shared fence, before any imported mutation. */
export async function assertExternalCalendarAccess(tx: DbTransaction, provider: string, calendarID: string, context?: ExternalCalendarAccessContext) {
  if (!context) return;
  if (provider !== "google" || !Number.isSafeInteger(context.revision) || context.revision < 1) throw new Error("Invalid calendar access context.");
  const [source] = await tx.select({ id: externalCalendars.id }).from(externalCalendars).where(and(eq(externalCalendars.id, context.linkID), eq(externalCalendars.provider, provider), eq(externalCalendars.calendarID, calendarID), eq(externalCalendars.userID, context.userID), eq(externalCalendars.accountID, context.accountID), eq(externalCalendars.externalCalendarID, context.externalCalendarID), eq(externalCalendars.disabled, false), eq(externalCalendars.supportsEvents, true), eq(externalCalendars.providerAccessRevision, context.revision)));
  if (!source) throw new Error("Calendar access changed during sync. Retry with fresh discovery.");
}
