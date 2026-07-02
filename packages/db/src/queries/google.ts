import { and, eq, inArray } from "drizzle-orm";
import { account, calendarEvents, calendarMembers, calendars, db, events, googleCalendars, googleEvents } from "../index"
import { GoogleCheck } from "@musubi/types";

export async function googleCheck(userID: string): Promise<GoogleCheck> {
  const [google] = await db.select()
    .from(account)
    .where(and(
      eq(account.userId, userID),
      eq(account.providerId, "google"),
    ));

  const isLinked = !!google;
  const calendarConnected = !!google?.refreshToken &&
    (google.scope ?? "").includes("https://www.googleapis.com/auth/calendar");

  return { isLinked, calendarConnected }
}

export async function getGoogleRefreshToken(userID: string) {
  const [google] = await db.select()
    .from(account)
    .where(and(
      eq(account.userId, userID),
      eq(account.providerId, "google"),
    ));

  return google?.refreshToken;
}

export async function cleanUsersGoogleTokens(userID: string) {
  await db.update(account).set({
    refreshToken: null,
    accessToken: null,
    accessTokenExpiresAt: null,
    scope: null,
  })
    .where(and(
      eq(account.userId, userID),
      eq(account.providerId, "google"),
    ));
}

export async function doesGoogleCalIDExistsForUser(userID: string, googleCalID: string) {
  const [res] = await db.select().from(googleCalendars).where(and(
    eq(googleCalendars.googleCalendarID, googleCalID),
    eq(googleCalendars.userID, userID)
  ))

  return !!res;
}

export async function importGoogleCalendar(userID: string, g: { id: string, summary: string, backgroundColor: string }) {
  await db.transaction(async (tx) => {
    const [cal] = await tx.insert(calendars)
      .values({ creatorID: userID, name: g.summary, color: g.backgroundColor }).returning();
    await tx.insert(googleCalendars)
      .values({ userID, calendarID: cal.id, googleCalendarID: g.id, syncToken: null });
    await tx.insert(calendarMembers).values({
      userID: cal.creatorID,
      calendarID: cal.id,
    })
  });
}

export async function importGoogleEvent(userID: string, eventID: string, googleCalendarID: string, googleEventID: string) {
  await db.insert(googleEvents)
    .values({ eventID, googleCalendarID, googleEventID }).returning();
}

export async function getUserGoogleCalendars(userID: string) {
  const cals = db.select({
    calendarID: googleCalendars.calendarID,
    googleCalendarID: googleCalendars.googleCalendarID,
    syncToken: googleCalendars.syncToken,
    calColor: calendars.color,
  }).from(googleCalendars)
    .innerJoin(calendars, eq(googleCalendars.calendarID, calendars.id))
    .where(eq(googleCalendars.userID, userID));

  return cals;
}

export async function setGoogleSyncToken(calendarID: string, token: string | null) {
  await db.update(googleCalendars).set({ syncToken: token }).where(eq(googleCalendars.calendarID, calendarID));
}

export async function clearGoogleCalendarEvents(calendarID: string) {
  await db.delete(events).where(inArray(events.id,
    db.select({ id: calendarEvents.eventID }).from(calendarEvents)
      .where(eq(calendarEvents.calendarID, calendarID))));
}

export async function applyGoogleEvent(userID: string, event: any, calendarID: string, googleCalendarID: string, calColor: string) {
  if (event.status === "cancelled") {
    await db.delete(events).where(inArray(events.id,
      db.select({ id: googleEvents.eventID }).from(googleEvents)
        .where(and(
          eq(googleEvents.googleCalendarID, googleCalendarID),
          eq(googleEvents.googleEventID, event.id)
        ))));
    return;
  }

  const isAllDay = !event.start.dateTime;
  const values = {
    title: event.summary ?? "(untitled)",
    color: calColor,
    start: new Date(event.start.dateTime ?? event.start.date),
    end: isAllDay
      ? new Date(new Date(event.end.date).getTime() - 86400000)   // -1 day (Google end.date is exclusive)
      : new Date(event.end.dateTime),
    isAllDay,
    description: event.description ?? null,
    location: event.location ?? null,
    organizer: event.organizer?.email ?? "",
    recurrence: event.recurrence?.join("\n") ?? null,
  };

  await db.transaction(async (tx) => {
    const [map] = await tx.select({
      eventID: googleEvents.eventID,
    }).from(googleEvents).where(and(
      eq(googleEvents.googleCalendarID, googleCalendarID),
      eq(googleEvents.googleEventID, event.id)
    ));

    if (map) {
      await tx.update(events).set(values).where(eq(events.id, map.eventID));
    } else {
      const [ev] = await tx.insert(events).values({ id: crypto.randomUUID(), ...values, creatorID: userID }).returning();
      await tx.insert(calendarEvents).values({ eventID: ev.id, calendarID });
      await tx.insert(googleEvents).values({ eventID: ev.id, googleCalendarID, googleEventID: event.id });
    }
  });
}

export async function getGoogleLinkForCalendar(calendarID: string): Promise<{ googleCalendarID: string, userID: string } | null> {
  const [cal] = await db.select({
    googleCalendarID: googleCalendars.googleCalendarID,
    userID: googleCalendars.userID
  }).from(googleCalendars)
    .where(eq(googleCalendars.calendarID, calendarID));

  return cal;
}

export async function getGoogleEventID(eventID: string, googleCalendarID: string) {
  const [res] = await db.select({ googleEventID: googleEvents.googleEventID })
    .from(googleEvents).where(and(
      eq(googleEvents.eventID, eventID),
      eq(googleEvents.googleCalendarID, googleCalendarID)
    ));

  return res?.googleEventID ?? null;
}
