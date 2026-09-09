import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { EventSchema } from "@musubi/types";
import { db, user, account, caldavAccounts, events, externalEvents, calendarMembers, externalCalendars, eventOutbox, createCalendar, createEvent } from "..";
import { getEventDeliveryInbox } from "./event-delivery-inbox";

async function run(provider: "google" | "microsoft") {
  assert.equal(process.env.ENVIRONMENT, "test");
  const fullRole = provider === "google" ? "owner" : "microsoft:private=yes;edit=yes";
  const userID = `inbox-google-privacy-${randomUUID()}`;
  const otherID = `inbox-google-privacy-other-${randomUUID()}`;
  await db.insert(user).values([userID, otherID].map(id => ({ id, name: id, email: `${id}@example.test` })));
  try {
    const calendar = await createCalendar({ creatorID: userID, name: "Private mirror", color: "#112233" });
    const accountID = randomUUID();
    const accountRowID = randomUUID();
    const sourceID = randomUUID();
    await db.insert(account).values({ id: accountRowID, accountId: accountID, providerId: provider, userId: userID });
    await db.insert(externalCalendars).values({ id: sourceID, provider, userID, accountID, calendarID: calendar.id, externalCalendarID: "private-remote", providerAccessRole: fullRole });
    // There is deliberately no live event: retained delete receipts need the same gate.
    const event = EventSchema.parse({ id: randomUUID(), creatorID: userID, title: "Sensitive retained title", color: "#112233", organizer: userID, start: new Date("2026-01-01T09:00:00Z"), end: new Date("2026-01-01T10:00:00Z"), isAllDay: false, isCanceled: false, originCalendarID: calendar.id, calendars: [calendar.id] });
    const receiptID = randomUUID();
    await db.insert(eventOutbox).values({ id: receiptID, actorID: userID, mutationID: randomUUID(), position: 0, eventID: event.id, revision: 1, calendarID: calendar.id, externalCalendarLinkID: sourceID, provider, userID, accountID, externalCalendarID: "private-remote", action: "delete", payload: { event }, status: "cancelled" });
    const original = (await db.select().from(eventOutbox).where(eq(eventOutbox.id, receiptID)))[0];
    const expectTitle = async (title: string, reason: string) => {
      assert.deepEqual((await getEventDeliveryInbox(userID)).items, [{ eventId: event.id, savedTitle: title }], reason);
    };
    const source = async (patch: Partial<typeof externalCalendars.$inferInsert>) => {
      await db.update(externalCalendars).set(patch).where(eq(externalCalendars.id, sourceID));
    };
    await expectTitle(event.title, "accepted owner at generation zero");
    await source({ providerAccessRole: null });
    await expectTitle(event.title, "explicit pre-discovery compatibility");
    for (const role of provider === "google" ? ["reader", "writerWithoutPrivateAccess", "unknown", "unexpected"] : ["microsoft:private=no;edit=yes", "microsoft:private=unknown;edit=yes", "unexpected"]) {
      await source({ providerAccessRole: role, cursor: "stale" });
      await expectTitle("Calendar event", `restricted ${role} must hide historical title`);
    }
    await source({ providerAccessRole: fullRole, providerAccessRevision: 2, cursor: null });
    await expectTitle("Calendar event", "upgraded grant has not refreshed");
    await source({ cursor: "" });
    await expectTitle("Calendar event", "empty cursor cannot restore titles");
    await source({ cursor: "fresh-success" });
    await expectTitle(event.title, "fresh successful privileged sync restores projection");
    await source({ providerAccessRole: null });
    await expectTitle("Calendar event", "null role after discovery is not legacy");
    await source({ providerAccessRole: fullRole });
    for (const role of ["viewer", "editor", "owner"]) {
      await db.update(calendarMembers).set({ role }).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, userID)));
      await expectTitle(role === "viewer" && provider === "google" ? "Calendar event" : event.title, `local ${role}`);
    }
    for (const [patch, reset] of [
      [{ disabled: true }, { disabled: false }],
      [{ supportsEvents: false }, { supportsEvents: true }],
      [{ accountID: "different-account" }, { accountID }],
      [{ externalCalendarID: "different-remote" }, { externalCalendarID: "private-remote" }],
      [{ userID: otherID }, { userID }],
      [{ calendarID: null }, { calendarID: calendar.id }],
      [{ provider: "caldav" }, { provider }],
    ] as const) {
      await source(patch);
      await expectTitle("Calendar event", `source identity/access changed: ${JSON.stringify(patch)}`);
      await source(reset);
    }
    await db.update(account).set({ syncStatus: "disabled" }).where(eq(account.id, accountRowID));
    await expectTitle("Calendar event", "disconnected account");
    await db.delete(account).where(eq(account.id, accountRowID));
    await expectTitle("Calendar event", "removed account");
    const preserved = (await db.select().from(eventOutbox).where(eq(eventOutbox.id, receiptID)))[0];
    assert.deepEqual(preserved, original, "read projection never rewrites accepted intent or receipt metadata");
    await db.update(eventOutbox).set({ provider: "caldav" }).where(eq(eventOutbox.id, receiptID));
    await expectTitle("Calendar event", "CalDAV receipts also require their own connected source and fresh readable event");
    await db.update(eventOutbox).set({ provider }).where(eq(eventOutbox.id, receiptID));
    await db.delete(externalCalendars).where(eq(externalCalendars.id, sourceID));
    await expectTitle("Calendar event", "missing source remains visible without its title");
    await db.insert(externalCalendars).values({ provider, userID, accountID, calendarID: calendar.id, externalCalendarID: "private-remote", providerAccessRole: fullRole });
    await db.insert(account).values({ id: accountRowID, accountId: accountID, providerId: provider, userId: userID });
    await expectTitle("Calendar event", "replacement source cannot authorize old link's receipt");
    assert.deepEqual((await getEventDeliveryInbox(otherID)).items, [], "receipts remain scoped to their user");
  } finally {
    await db.delete(user).where(eq(user.id, userID));
    await db.delete(user).where(eq(user.id, otherID));
  }
  console.log(`${provider} delivery inbox privacy integration: OK`);
}
async function runCaldav() {
  const userID = `inbox-caldav-privacy-${randomUUID()}`;
  const accountID = randomUUID();
  await db.insert(user).values({ id: userID, name: userID, email: `${userID}@example.test` });
  try {
    const calendar = await createCalendar({ creatorID: userID, name: "CalDAV mirror", color: "#112233" });
    const [source] = await db.insert(externalCalendars).values({ provider: "caldav", userID, accountID, calendarID: calendar.id, externalCalendarID: "private-remote" }).returning();
    const event = EventSchema.parse({ id: randomUUID(), creatorID: userID, title: "Original accepted title", color: "#112233", organizer: userID, start: "2026-01-01T09:00:00Z", end: "2026-01-01T10:00:00Z", isAllDay: false, isCanceled: false, originCalendarID: calendar.id, calendars: [calendar.id] });
    await createEvent(event, event.calendars);
    const [receipt] = await db.insert(eventOutbox).values({ id: randomUUID(), actorID: userID, mutationID: randomUUID(), position: 0, eventID: event.id, revision: 1, calendarID: calendar.id, externalCalendarLinkID: source!.id, provider: "caldav", userID, accountID, externalCalendarID: "private-remote", action: "delete", payload: { event }, status: "cancelled" }).returning();
    const expectTitle = async (title: string, reason: string) => {
      assert.deepEqual((await getEventDeliveryInbox(userID)).items, [{ eventId: event.id, savedTitle: title }], reason);
    };
    // An OAuth row must never stand in for a CalDAV connection, even at legacy
    // null-role/revision-zero where Google and Microsoft permit compatibility.
    await db.insert(account).values({ id: randomUUID(), accountId: accountID, providerId: "caldav", userId: userID });
    await expectTitle("Calendar event", "OAuth-only CalDAV source cannot authorize current content");
    await db.insert(caldavAccounts).values({ id: accountID, userID, serverUrl: "https://fixture.invalid", username: "fixture", encryptedPassword: "unused-fixture" });
    await expectTitle(event.title, "real CalDAV connection retains pre-discovery compatibility");
    await db.update(events).set({ title: "Current permitted title" }).where(eq(events.id, event.id));
    await expectTitle("Current permitted title", "readable CalDAV projection uses current content");
    await db.update(externalCalendars).set({ providerAccessRole: "caldav:read=no;freebusy=yes" }).where(eq(externalCalendars.id, source!.id));
    await expectTitle("Calendar event", "explicit denied read hides current content");
    await db.update(events).set({ providerReadRetiredRevision: 1 }).where(eq(events.id, event.id));
    await db.update(externalCalendars).set({ providerAccessRole: null }).where(eq(externalCalendars.id, source!.id));
    await expectTitle("Calendar event", "unknown grant cannot restore a retired event through OAuth fallback");
    await db.update(externalCalendars).set({ providerAccessRole: "caldav:read=yes;freebusy=yes" }).where(eq(externalCalendars.id, source!.id));
    await expectTitle("Calendar event", "grant restoration alone cannot reveal retired content");
    const [mapping] = await db.insert(externalEvents).values({ provider: "caldav", eventID: event.id, calendarID: calendar.id, externalCalendarID: "private-remote", externalEventID: "resource.ics", etag: '"fresh"', readRedactionRevision: 1 }).returning();
    await expectTitle("Calendar event", "retired mapping is not a fresh read");
    await db.update(externalEvents).set({ readRedactionRevision: null, etag: null }).where(eq(externalEvents.id, mapping!.id));
    await expectTitle("Calendar event", "unconfirmed mapping is not a fresh read");
    await db.update(externalEvents).set({ etag: '"fresh"' }).where(eq(externalEvents.id, mapping!.id));
    await expectTitle("Current permitted title", "fresh authorized mapped resource restores current title");
    await db.delete(caldavAccounts).where(eq(caldavAccounts.id, accountID));
    await expectTitle("Calendar event", "OAuth row cannot preserve a removed CalDAV connection");
    await db.delete(events).where(eq(events.id, event.id));
    await expectTitle("Calendar event", "retained CalDAV delete never falls back to immutable private title");
    assert.deepEqual((await db.select().from(eventOutbox).where(eq(eventOutbox.id, receipt!.id)))[0], receipt, "projection leaves accepted receipt immutable");
  } finally {
    await db.delete(user).where(eq(user.id, userID));
  }
  console.log("caldav delivery inbox privacy integration: OK");
}
async function main() {
  await run("google");
  await run("microsoft");
  await runCaldav();
}
main().finally(() => db.$client.end());
