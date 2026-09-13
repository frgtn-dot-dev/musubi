import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, user, session, calendars, tasks, externalCalendars } from "@musubi/db";
import { loadUsageSnapshot } from "./metrics";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test", "Run only against a test database");
  const id = randomUUID();
  const calendar = randomUUID();
  const before = await loadUsageSnapshot();
  await db.insert(user).values({id, name: "Metrics fixture", email: `${id}@example.test`});
  try {
    await db.insert(calendars).values({id: calendar, creatorID: id, name: "Private fixture", color: "#123456"});
    await db.insert(externalCalendars).values({provider: "google", userID: id, accountID: id, calendarID: calendar, externalCalendarID: id, supportsTasks: true});
    await db.insert(session).values([
      {id: randomUUID(), token: randomUUID(), userId: id, updatedAt: new Date(), expiresAt: new Date(Date.now()+60000), userAgent: "Mozilla/5.0 (iPad) CriOS/140 Mobile Safari/604"},
      {id: randomUUID(), token: randomUUID(), userId: id, updatedAt: new Date(), expiresAt: new Date(0), userAgent: "secret-user-agent"},
    ]);
    await db.insert(tasks).values([
      {id: randomUUID(), creatorID: id, calendarID: calendar, title: "Private live task", status: "in-process", priority: 5},
      {id: randomUUID(), creatorID: id, calendarID: calendar, title: "Private deleted task", deletedAt: new Date()},
    ]);
    const after = await loadUsageSnapshot();
    assert.equal(after.users, before.users + 1);
    assert.equal(after.activeSessions, before.activeSessions + 1, "expired sessions excluded");
    assert.equal(after.activeUsers, before.activeUsers + 1);
    const sum = (rows: {v: number}[]) => rows.reduce((n, r) => n+r.v, 0);
    assert.equal(sum(after.devices), after.activeSessions, "SQL CASE grouping yields exactly one family per session");
    assert.equal(sum(after.devices.filter(r => r.device === "tablet" && r.os === "ios" && r.browser === "chrome")),
      sum(before.devices.filter(r => r.device === "tablet" && r.os === "ios" && r.browser === "chrome")) + 1);
    assert.equal(sum(after.taskRows), sum(before.taskRows)+1, "tombstones excluded, provider join does not duplicate");
    assert.equal(sum(after.taskRows.filter(r => r.provider === "google" && r.status === "in-process" && r.priority === 5)),
      sum(before.taskRows.filter(r => r.provider === "google" && r.status === "in-process" && r.priority === 5))+1);
    assert.equal(sum(after.providerCalendars), sum(before.providerCalendars)+1);
    assert.ok(!JSON.stringify(after).includes("Private"), "snapshot contains no object content");
    console.log("metrics PostgreSQL integration: sessions, families, task tombstones and provider joins passed");
  } finally {
    await db.delete(user).where(eq(user.id, id));
  }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
