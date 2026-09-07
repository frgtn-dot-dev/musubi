import {
  getCalendar, getCaldavAccountsByUser, getEventCalendars, getEventOrigin,
  getExternalLinkForCalendar, getOAuthCredentials, getUserRoleForCalendar,
} from "@musubi/db";
import { can, EventWriteError, NotFoundError } from "@musubi/types";

/** App authorization only. Callers MUST complete provider preflight before mutating.
 * The original connected-account owner's viewer role is a provider projection;
 * it is not an app sharing grant. Generic assertCan/canDo intentionally stay strict.
 */
export async function hasEventCalendarAccess(userID: string, calendarID: string) {
  const role = await getUserRoleForCalendar(userID, calendarID);
  if (can(role, "editEvents")) return true;
  if (!role) return false;
  const link = await getExternalLinkForCalendar(calendarID);
  if (!link || link.userID !== userID) return false;
  if ((await getCalendar(calendarID)).creatorID !== userID) return false;
  if (link.provider === "caldav") {
    return (await getCaldavAccountsByUser(userID)).some((account) => account.id === link.accountID);
  }
  return ["google", "microsoft"].includes(link.provider) &&
    Boolean(await getOAuthCredentials(userID, link.provider, link.accountID));
}

export async function assertEventCalendarAccess(userID: string, calendarID: string) {
  if (!(await hasEventCalendarAccess(userID, calendarID))) {
    throw new EventWriteError("event-write", "denied");
  }
}

export async function assertEventContentAccess(userID: string, eventID: string) {
  const origin = await getEventOrigin(eventID);
  if (!origin) throw new NotFoundError("Event not found...");
  if (origin.originCalendarID) {
    await assertEventCalendarAccess(userID, origin.originCalendarID);
    return;
  }
  // Preserve the existing legacy local-origin fallback, never prefer a copy.
  if (origin.creatorID === userID) return;
  for (const calendarID of await getEventCalendars(eventID)) {
    if (can(await getUserRoleForCalendar(userID, calendarID), "editEvents")) return;
  }
  throw new EventWriteError("event-write", "denied");
}
