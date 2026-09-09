import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
async function main() {
  assert.equal(process.env.ENVIRONMENT, "test"); assert.ok(process.env.DATABASE_URL); assert.ok(process.env.RADICALE_URL);
  const { db, user, events, getCaldavAlarmContext, caldavAlarmVersion, saveCaldavAccount, importExternalCalendar, replaceExternalEventResource, getEventSnapshot, commitEventDeliveryResolution } = await import("@musubi/db");
  const { config } = await import("@musubi/config");
  const { encryptSecret } = await import("../crypto");
  const { caldavAdapter } = await import("./caldav");
  const { normalizeCaldavResource } = await import("./caldav_time");
  const { withoutCaldavAlarm } = await import("./caldav_alarms");
  const { queueCaldavAlarms } = await import("../caldav_alarms");
  const { deliverEventOutbox } = await import("../event_delivery");
  const { prepareEventDeliveryResolution } = await import("../event_resolution");
  const username = process.env.RADICALE_USERNAME ?? "musubi", password = process.env.RADICALE_PASSWORD ?? "musubi-radicale-test";
  for (const kind of ["one-off", "zoned-series", "all-day-series"]) {
  const owner = `alarm-native-${randomUUID()}`, collection: string = new URL(`${username}/musubi-alarms-${randomUUID()}/`, process.env.RADICALE_URL).href;
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`, resource = collection + "alarm.ics";
  const flag = config.api.caldavAlarmEditsEnabled; let created = false;
  await db.insert(user).values({ id: owner, name: "Alarm fixture", email: `${owner}@example.test` });
  try {
    assert.equal((await fetch(collection, { method: "MKCALENDAR", headers: { authorization } })).status, 201); created = true;
    config.api.caldavAlarmEditsEnabled = true;
    const account = await saveCaldavAccount(owner, process.env.RADICALE_URL!, username, encryptSecret(password));
    const calendar = await importExternalCalendar("caldav", owner, account.id, "Alarm fixture", { externalId: collection, name: "Alarm fixture", color: "#7A8BA3", supportsEvents: true });
    let source = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Musubi fixture//EN", "BEGIN:VEVENT", "UID:alarm", "DTSTAMP:20260909T000000Z", "DTSTART;TZID=Europe/Prague:20260910T090000", "DTEND;TZID=Europe/Prague:20260910T100000", "SUMMARY:Alarm proof", "X-PRIVATE:Preserve", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Preserve alarm description", "END:VALARM", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
    if (kind !== "one-off") source = source.replace("SUMMARY:Alarm proof", "RRULE:FREQ=DAILY;COUNT=4\r\nSUMMARY:Alarm proof").replace(/20260910T/g, "20260328T");
    if (kind === "all-day-series") source = source.replace("DTSTART;TZID=Europe/Prague:20260328T090000", "DTSTART;VALUE=DATE:20260328").replace("DTEND;TZID=Europe/Prague:20260328T100000", "DTEND;VALUE=DATE:20260329");
    assert.equal((await fetch(resource, { method: "PUT", headers: { authorization, "Content-Type": "text/calendar", "If-None-Match": "*" }, body: source })).status, 201);
    const first = await fetch(resource, { headers: { authorization } }), data = await first.text(), etag = first.headers.get("etag")!;
    await replaceExternalEventResource("caldav", owner, calendar.id, collection, resource, normalizeCaldavResource({ url: resource, data, etag }).map(event => ({ externalId: resource, etag, icalUid: "alarm", values: { title: event.title, start: event.start, end: event.end, color: "#7A8BA3", isAllDay: event.isAllDay, description: event.description, location: event.location, organizer: "", recurrence: event.recurrence, url: event.url }, providerState: event.providerState, time: { timeModel: event.timeModel! } })));
    const [event] = await db.select().from(events).where(eq(events.creatorID, owner)), original = await getEventSnapshot(event.id);
    const context = await getCaldavAlarmContext(owner, event.id), observed = await caldavAdapter.readCaldavAlarm!(context);
    const request = { ...(kind !== "one-off" ? { scope: "series" as const } : {}), operationID: randomUUID(), expectedRevision: event.revision, expectedStateVersion: caldavAlarmVersion(context, observed.data), provider: "caldav", alarms: { minutesBeforeStart: 30 } };
    const receipt = await queueCaldavAlarms(owner, event.id, request);
    assert.equal((await deliverEventOutbox(receipt.operationID, () => caldavAdapter))?.status, "completed");
    let latest = await fetch(resource, { headers: { authorization } }), body = await latest.text();
    assert.equal(withoutCaldavAlarm(body), withoutCaldavAlarm(data)); assert.ok(body.includes("TRIGGER:-PT30M") && body.includes("DESCRIPTION:Preserve alarm description"));
    const fresh = await getCaldavAlarmContext(owner, event.id), evidence = await caldavAdapter.readCaldavAlarm!(fresh);
    const second = await queueCaldavAlarms(owner, event.id, { ...request, operationID: randomUUID(), expectedStateVersion: caldavAlarmVersion(fresh, evidence.data), alarms: { minutesBeforeStart: null } });
    assert.ok((await fetch(resource, { method: "PUT", headers: { authorization, "Content-Type": "text/calendar", "If-Match": latest.headers.get("etag")! }, body: body.replace("-PT30M", "-PT20M") })).ok);
    assert.equal((await deliverEventOutbox(second.operationID, () => caldavAdapter))?.status, "conflict");
    const prepared = await prepareEventDeliveryResolution(owner, event.id, second.operationID, () => caldavAdapter);
    const replacement = await commitEventDeliveryResolution(owner, prepared.proof, { mutationId: randomUUID(), expectedLocalRevision: event.revision, expectedLatestOperationId: second.operationID, expectedRemoteExists: true, expectedRemoteEtag: prepared.preview.remoteEtag, expectedReminderStateVersion: prepared.preview.caldavAlarmResolution!.stateVersion });
    assert.equal((await deliverEventOutbox(replacement, () => caldavAdapter))?.status, "completed");
    latest = await fetch(resource, { headers: { authorization } }); body = await latest.text();
    assert.equal(body, withoutCaldavAlarm(data)); assert.deepEqual(await getEventSnapshot(event.id), original);
    console.log(`${kind}: Radicale alarms: native positive privilege, full-resource CAS, preserved bytes, conflict and explicit alarm removal: OK`);
  } finally {
    config.api.caldavAlarmEditsEnabled = flag;
    if (created) await fetch(collection, { method: "DELETE", headers: { authorization } });
    await db.delete(user).where(eq(user.id, owner));
  }
  }
  await db.$client.end();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
