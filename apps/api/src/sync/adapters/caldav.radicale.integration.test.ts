import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Task } from "@musubi/types";
import type { NormalizedChange, NormalizedTask } from "../adapter";

process.env.FEDERATION_ALLOW_PRIVATE_HOSTS ??= "true";
process.env.CALDAV_ENC_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";

const serverUrl = process.env.RADICALE_URL ?? "http://127.0.0.1:5232/";
const username = process.env.RADICALE_USERNAME ?? "musubi";
const password = process.env.RADICALE_PASSWORD ?? "musubi-radicale-test";

async function main() {
  if (process.env.ENVIRONMENT !== "test") {
    throw new Error(
      "Refusing to run Radicale integration test unless ENVIRONMENT=test",
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "Refusing to run Radicale integration test without an explicit DATABASE_URL",
    );
  }

  const { eq } = await import("drizzle-orm");
  const { db, events, externalCalendars, externalEvents, getEventSnapshot, getUserExternalCalendars, setCursor, saveCaldavAccount, user } = await import("@musubi/db");
  const { config } = await import("@musubi/config");
  const { syncProvider } = await import("../engine");
  const { caldavAdapter, patchEventIcal, prepareCaldavSeriesWrite } = await import("./caldav");
  const { createGuardedCaldavFetch } = await import("../caldav_client");
  const { encryptSecret } = await import("../crypto");

  const userID = `radicale-interop-${randomUUID()}`;
  const collectionURL = new URL(
    `${username}/musubi-vtodo-${randomUUID()}/`,
    serverUrl,
  ).href;
  const basicAuth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const davFetch = createGuardedCaldavFetch({ allowPrivate: true });
  let collectionCreated = false;
  const enabled = config.api.eventTimeEditsEnabled;

  await db.insert(user).values({
    id: userID,
    name: "Radicale interop test",
    email: `${userID}@example.test`,
  });

  try {
    const createCollection = await davFetch(collectionURL, {
      method: "MKCALENDAR",
      headers: { authorization: basicAuth },
    });
    assert.equal(
      createCollection.status,
      201,
      "Radicale must create a collection",
    );
    collectionCreated = true;

    const account = await saveCaldavAccount(
      userID,
      serverUrl,
      username,
      encryptSecret(password),
    );
    const { calendars } = await caldavAdapter.listCalendars(userID, account.id);
    const calendar = calendars.find(
      (entry) => entry.externalId === collectionURL,
    );
    assert.ok(calendar, "Radicale collection must be discoverable");
    assert.equal(calendar.supportsTasks, true);

    const pushTaskCreate = caldavAdapter.pushTaskCreate;
    const pushTaskUpdate = caldavAdapter.pushTaskUpdate;
    const pushTaskDelete = caldavAdapter.pushTaskDelete;
    assert.ok(pushTaskCreate && pushTaskUpdate && pushTaskDelete);

    const task = taskValues(userID, "Created by Musubi");
    const created = await pushTaskCreate(
      userID,
      account.id,
      collectionURL,
      task,
    );
    assert.ok(created.etag, "Radicale create must provide or expose an ETag");
    assert.equal(created.icalUid, task.id);

    const createdPull = await caldavAdapter.fetchChanges(
      userID,
      account.id,
      collectionURL,
      null,
    );
    const pulledCreated = findTask(createdPull.changes, created.externalTaskId);
    assert.ok(createdPull.nextCursor, "Radicale must expose a sync token");
    assert.equal(createdPull.reset, true);
    assert.equal(pulledCreated?.title, task.title);
    assert.equal(pulledCreated?.icalUid, task.id);
    assert.equal(pulledCreated?.etag, created.etag);

    const updatedTask = { ...task, title: "Updated by Musubi", priority: 3 };
    const updated = await pushTaskUpdate(
      userID,
      account.id,
      collectionURL,
      created.externalTaskId,
      updatedTask,
      created,
    );
    assert.ok(updated?.etag, "Radicale update must retain an ETag");
    assert.equal(updated?.icalUid, task.id);

    const updatedPull = await caldavAdapter.fetchChanges(
      userID,
      account.id,
      collectionURL,
      createdPull.nextCursor,
    );
    assert.equal(updatedPull.reset, false);
    const pulledUpdated = findTask(updatedPull.changes, created.externalTaskId);
    assert.equal(pulledUpdated?.title, updatedTask.title);
    assert.equal(pulledUpdated?.priority, updatedTask.priority);
    assert.equal(pulledUpdated?.icalUid, task.id);

    await pushTaskDelete(
      userID,
      account.id,
      collectionURL,
      created.externalTaskId,
      { ...created, ...updated },
    );
    const deletedPull = await caldavAdapter.fetchChanges(
      userID,
      account.id,
      collectionURL,
      updatedPull.nextCursor,
    );
    assert.equal(deletedPull.reset, false);
    assert.equal(
      findTask(deletedPull.changes, created.externalTaskId)?.deleted,
      true,
    );

    config.api.eventTimeEditsEnabled = true;
    const resourceURL = new URL("family.ics", collectionURL).href;
    const component = (...lines: string[]) => ["BEGIN:VEVENT", "UID:family", "DTSTAMP:20260908T000000Z", ...lines, "END:VEVENT"].join("\r\n");
    const master = component("DTSTART;TZID=Europe/Prague:20260328T090000", "DTEND;TZID=Europe/Prague:20260328T100000", "RRULE:FREQ=DAILY;COUNT=4", "SUMMARY:Master", "X-MUSUBI-FIXTURE:keep", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Keep alarm", "END:VALARM");
    const moved = component("RECURRENCE-ID;TZID=Europe/Prague:20260329T090000", "DTSTART;TZID=Europe/Prague:20260329T140000", "DTEND;TZID=Europe/Prague:20260329T160000", "SUMMARY:Moved");
    const put = async (...components: string[]) => {
      const result = await davFetch(resourceURL, { method: "PUT", headers: { authorization: basicAuth, "content-type": "text/calendar" }, body: ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Musubi//Fixture//EN", ...components, "END:VCALENDAR"].join("\r\n") });
      assert.ok(result.ok, `Fixture PUT: ${result.status}`);
    };
    const sync = () => syncProvider(caldavAdapter, userID, { id: account.id, label: "Fixture" });
    const rows = () => db.select().from(events).where(eq(events.creatorID, userID)).orderBy(events.id);
    await put(moved, master);
    const rawBefore = await (await davFetch(resourceURL, { headers: { authorization: basicAuth } })).text();
    await sync();
    const initial = await rows();
    assert.equal(initial.length, 2);
    assert.equal(initial.find(event => event.title === "Moved")!.end.getTime() - initial.find(event => event.title === "Moved")!.start.getTime(), 7200000);
    await sync();
    assert.deepEqual(await rows(), initial);
    const rawAfter = await (await davFetch(resourceURL, { headers: { authorization: basicAuth } })).text();
    assert.equal(rawAfter, rawBefore, "Pull preserves the complete server resource, alarms and extensions");
    const [link] = (await getUserExternalCalendars("caldav", userID, account.id)).filter(link => link.externalCalendarID === collectionURL);
    assert.ok(link);
    const localMaster = (await getEventSnapshot(initial.find(event => !event.seriesID)!.id))!;
    const localChildren = await Promise.all(initial.filter(event => event.seriesID).map(event => getEventSnapshot(event.id)));
    const [familyMapping] = await db.select().from(externalEvents).where(eq(externalEvents.eventID, localMaster.id));
    const intent = { master: localMaster, children: localChildren.map(child => child!), ref: { externalEventId: resourceURL, etag: familyMapping.etag, icalUid: "family" } };
    const readSeries = () => caldavAdapter.readCaldavSeries!(userID, account.id, collectionURL, intent);
    const familyEvidence = await readSeries();
    assert.equal(familyEvidence.data, rawBefore);
    assert.equal(familyEvidence.exceptions.length, 1);
    assert.equal(familyEvidence.exceptions[0]!.title, "Moved");
    config.api.eventTimeEditsEnabled = false;
    await assert.rejects(readSeries);
    config.api.eventTimeEditsEnabled = true;
    await assert.rejects(() => caldavAdapter.readCaldavSeries!("other-user", account.id, collectionURL, intent));
    await assert.rejects(() => caldavAdapter.readCaldavSeries!(userID, account.id, collectionURL, { ...intent, children: [] }));
    await assert.rejects(() => caldavAdapter.readCaldavSeries!(userID, account.id, collectionURL, { ...intent, ref: { ...intent.ref, externalEventId: resourceURL + "#child" } }));

    const concurrentlyEdited = familyEvidence.data.replace("SUMMARY:Moved", "SUMMARY:Concurrent child");
    assert.notEqual(concurrentlyEdited, familyEvidence.data);
    const childWrite = await davFetch(resourceURL, { method: "PUT", headers: { authorization: basicAuth, "content-type": "text/calendar", "If-Match": familyEvidence.ref.etag! }, body: concurrentlyEdited });
    assert.ok(childWrite.ok);
    const afterChildResponse = await davFetch(resourceURL, { headers: { authorization: basicAuth } });
    assert.notEqual(afterChildResponse.headers.get("etag"), familyEvidence.ref.etag, "A child change invalidates the whole CalDAV resource ETag");
    const afterChild = await afterChildResponse.text();
    await assert.rejects(readSeries, /conflict/);
    const staleMasterWrite = await davFetch(resourceURL, { method: "PUT", headers: { authorization: basicAuth, "content-type": "text/calendar", "If-Match": familyEvidence.ref.etag! }, body: patchEventIcal(familyEvidence.data, localMaster, "family", { title: "Stale master rename" }) });
    assert.equal(staleMasterWrite.status, 412, "Resource CAS protects a concurrent exception edit");
    assert.equal(await (await davFetch(resourceURL, { headers: { authorization: basicAuth } })).text(), afterChild);
    assert.deepEqual(await rows(), initial, "Evidence and refused provider writes do not change local content");
    await put(moved, master);
    const restored = await readSeries();
    const write = prepareCaldavSeriesWrite(restored, intent, { title: "Renamed series", description: "Content-only description", location: "Test location" });
    const writeSeries = () => caldavAdapter.writeCaldavSeries!(userID, account.id, collectionURL, write);
    config.api.eventTimeEditsEnabled = false;
    await assert.rejects(writeSeries);
    config.api.eventTimeEditsEnabled = true;
    await assert.rejects(() => caldavAdapter.writeCaldavSeries!("other-user", account.id, collectionURL, write));
    await db.update(externalCalendars).set({ disabled: true }).where(eq(externalCalendars.calendarID, link.calendarID));
    await assert.rejects(writeSeries);
    await db.update(externalCalendars).set({ disabled: false }).where(eq(externalCalendars.calendarID, link.calendarID));
    const delivered = await writeSeries();
    assert.equal(delivered.master.title, "Renamed series");
    assert.equal(delivered.master.description, "Content-only description");
    assert.equal(delivered.master.location, "Test location");
    assert.deepEqual(delivered.exceptions.map(item => [item.title, item.timeModel]), restored.exceptions.map(item => [item.title, item.timeModel]));
    assert.ok(delivered.data.includes("X-MUSUBI-FIXTURE:keep"));
    assert.ok(delivered.data.includes("DESCRIPTION:Keep alarm"));
    assert.notEqual(delivered.ref.etag, restored.ref.etag);
    const recovered = await writeSeries();
    assert.equal(recovered.ref.etag, delivered.ref.etag);
    assert.equal(recovered.data, delivered.data);
    assert.deepEqual(await rows(), initial, "Adapter evidence alone never acknowledges local family mappings or edits local content");
    assert.deepEqual((await db.select().from(externalEvents).where(eq(externalEvents.eventID, localMaster.id)))[0], familyMapping);
    await put(moved, master); // Restore the synthetic fixture for the existing import regressions.
    await sync();
    console.log("Radicale complete series GET, accepted ETag, private-only evidence and concurrent-child CAS: OK");
    await setCursor(link.calendarID, null);
    await sync();
    assert.deepEqual(await rows(), initial, "Full reset preserves identity and revision");
    await put(master);
    await sync();
    assert.ok((await rows()).find(event => event.title === "Moved")!.deletedAt, "Delta omits and tombstones removed override");
    await put(master, moved);
    await sync();
    assert.deepEqual((await rows()).map(event => event.id), initial.map(event => event.id));
    assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.calendarID, link.calendarID))).length, 2);
    const removed = await davFetch(resourceURL, { method: "DELETE", headers: { authorization: basicAuth } });
    assert.ok(removed.ok);
    await sync();
    assert.ok((await rows()).every(event => event.deletedAt), "Resource deletion tombstones its complete family");
    console.log("Radicale VEVENT family HTTP delta/reset, revival, deletion and preservation: OK");
    console.log("Radicale VTODO create/update/delete interop: OK");
  } finally {
    config.api.eventTimeEditsEnabled = enabled;
    if (collectionCreated) {
      const deleted = await davFetch(collectionURL, {
        method: "DELETE",
        headers: { authorization: basicAuth },
      });
      assert.ok(
        deleted.ok || deleted.status === 404,
        `Radicale collection cleanup failed: ${deleted.status}`,
      );
    }
    await db.delete(user).where(eq(user.id, userID));
  }
}

function findTask(
  changes: NormalizedChange[],
  externalTaskId: string,
): NormalizedTask | undefined {
  for (const change of changes) {
    if (change.kind === "task" && change.data.externalId === externalTaskId)
      return change.data;
  }
  return undefined;
}

function taskValues(creatorID: string, title: string): Task {
  return {
    id: randomUUID(),
    creatorID,
    calendarID: randomUUID(),
    title,
    description: "Round-trip through Radicale",
    status: "needs-action",
    start: null,
    due: null,
    isAllDay: false,
    completedAt: null,
    percentComplete: 0,
    priority: 0,
    recurrence: null,
    relatedTo: null,
    sequence: 0,
    url: null,
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
