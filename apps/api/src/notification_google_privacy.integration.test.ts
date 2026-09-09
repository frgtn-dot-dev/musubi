import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db, user, account, events, eventUsers, externalCalendars, externalEvents,
  createCalendar, queuePendingNotification, getDuePendingNotifications, deletePendingNotifications,
} from "@musubi/db";
import { planDeliveries } from "./notification_dispatch";

async function run(provider: "google" | "microsoft") {
  assert.equal(process.env.ENVIRONMENT, "test");
  const owner = `notification-privacy-${randomUUID()}`;
  const recipient = `${owner}-guest`;
  await db.insert(user).values([owner, recipient].map(id => ({ id, name: id, email: `${id}@example.test` })));
  try {
    await db.insert(account).values({ id: randomUUID(), userId: owner, providerId: provider, accountId: owner });
    const calendar = await createCalendar({ creatorID: owner, name: "Native", color: "red" });
    const [source] = await db.insert(externalCalendars).values({ userID: owner, provider, accountID: owner, calendarID: calendar.id, externalCalendarID: "native" }).returning();
    const eventID = randomUUID();
    await db.insert(events).values({ id: eventID, creatorID: owner, originCalendarID: calendar.id, title: "Private appointment", organizer: owner, color: "red", start: new Date(), end: new Date() });
    await db.insert(eventUsers).values({ eventID, userID: recipient });
    const [mapping] = await db.insert(externalEvents).values({ eventID, calendarID: calendar.id, provider, externalCalendarID: "native", externalEventID: "event" }).returning();
    await queuePendingNotification({ userID: recipient, subjectID: eventID, kind: "event_changed", dueAt: new Date(0), payload: { kind: "cancelled", title: "Private appointment", start: new Date().toISOString(), isAllDay: false } });
    const check = async (eligible: boolean) => {
      const rows = (await getDuePendingNotifications(new Date())).filter(row => row.userID === recipient);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].eligible, eligible);
      assert.equal(planDeliveries(rows).deliveries.length, eligible ? 1 : 0);
    };
    await check(true); // deliberate revision-zero legacy behavior; guest has no calendar membership
    for (const role of provider === "google" ? ["reader", "unknown", "writerWithoutPrivateAccess"] : ["microsoft:private=no;edit=yes", "microsoft:private=unknown;edit=yes"]) {
      await db.update(externalCalendars).set({ providerAccessRole: role, providerAccessRevision: 1, cursor: "accepted" }).where(eq(externalCalendars.id, source.id));
      await check(false);
    }
    await db.update(externalCalendars).set({ providerAccessRole: provider === "google" ? "writer" : "microsoft:private=yes;edit=no", cursor: null }).where(eq(externalCalendars.id, source.id));
    await check(false);
    await db.update(externalCalendars).set({ cursor: "accepted" }).where(eq(externalCalendars.id, source.id));
    await check(true);
    await db.update(externalEvents).set({ readRedactionRevision: 1 }).where(eq(externalEvents.id, mapping.id));
    await check(false);
    // A late post-write notification callback can enqueue after redaction's purge.
    let queued = (await getDuePendingNotifications(new Date())).filter(row => row.userID === recipient);
    await deletePendingNotifications(queued.map(row => row.id));
    await queuePendingNotification({ userID: recipient, subjectID: eventID, kind: "event_changed", dueAt: new Date(0), payload: { kind: "cancelled", title: "Late private title", start: new Date().toISOString(), isAllDay: false } });
    await check(false);
    queued = (await getDuePendingNotifications(new Date())).filter(row => row.userID === recipient);
    await queuePendingNotification({ userID: recipient, subjectID: eventID, kind: "event_changed", dueAt: new Date(0), payload: { ...queued[0].payload, title: "Changed while sending" } });
    await deletePendingNotifications(queued.map(row => row.id), queued);
    await check(false); // post-send cleanup retains a newer payload
    await db.update(externalEvents).set({ readRedactionRevision: null, externalCalendarID: "different-source" }).where(eq(externalEvents.id, mapping.id));
    await check(false);
    await db.update(externalEvents).set({ externalCalendarID: "native" }).where(eq(externalEvents.id, mapping.id));
    await db.delete(externalCalendars).where(eq(externalCalendars.id, source.id));
    await check(false);
    await db.update(events).set({ deletedAt: new Date(), originCalendarID: null }).where(eq(events.id, eventID));
    await db.delete(externalEvents).where(eq(externalEvents.id, mapping.id));
    await check(false); // source removal's shared survivor tombstone
    await db.update(events).set({ deletedAt: null }).where(eq(events.id, eventID));
    await check(true); // ordinary local attendee notification
    await db.delete(eventUsers).where(eq(eventUsers.eventID, eventID));
    await check(false); // recipient lost all visibility
  } finally {
    await db.delete(user).where(eq(user.id, owner));
    await db.delete(user).where(eq(user.id, recipient));
  }
}
async function main() {
  await run("google");
  await run("microsoft");
}
main().then(() => { console.log("notification_google_privacy.integration.test.ts ok"); process.exit(0); }).catch(error => { console.error(error); process.exit(1); });
