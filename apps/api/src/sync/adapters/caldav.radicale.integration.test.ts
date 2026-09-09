import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { planEventScope } from "@musubi/calendar";
import type { Task } from "@musubi/types";
import type { NormalizedChange, NormalizedTask } from "../adapter";
import type { CaldavSeriesIntent } from "./caldav_series";

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
  const { db, events, eventOutbox, externalCalendars, externalEvents, applyLocalEventScope, getEventSnapshot, getUserExternalCalendars, setCursor, saveCaldavAccount, user } = await import("@musubi/db");
  const { config } = await import("@musubi/config");
  const { syncProvider } = await import("../engine");
  const { caldavAdapter, patchEventIcal, prepareCaldavSeriesWrite, prepareCaldavSeriesDeletion, prepareCaldavSeriesSplit } = await import("./caldav");
  const { createGuardedCaldavFetch } = await import("../caldav_client");
  const { encryptSecret } = await import("../crypto");
  const { prepareEventDeliveryResolution } = await import("../event_resolution");
  const { commitEventDeliveryResolution } = await import("@musubi/db");
  const { prepareCaldavSeries, prepareCaldavSeriesDelete, prepareCaldavSplit } = await import("../caldav_scope");
  const { deliverEventOutbox } = await import("../event_delivery");

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
    await assert.rejects(() => caldavAdapter.readCaldavSeriesResolution!(userID, account.id, collectionURL, intent, rawBefore), /conflict/);
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
    const comparison = await caldavAdapter.readCaldavSeriesResolution!(userID, account.id, collectionURL, intent, rawBefore);
    assert.equal(comparison.baseline.master.title, "Renamed series");
    assert.equal(comparison.evidence.data, delivered.data);
    assert.equal(comparison.evidence.ref.etag, delivered.ref.etag);
    assert.deepEqual(comparison.baseline.children, intent.children);
    config.api.eventTimeEditsEnabled = false;
    await assert.rejects(() => caldavAdapter.readCaldavSeriesResolution!(userID, account.id, collectionURL, intent, rawBefore));
    config.api.eventTimeEditsEnabled = true;
    await assert.rejects(() => caldavAdapter.readCaldavSeriesResolution!("other-user", account.id, collectionURL, intent, rawBefore));
    const recovered = await writeSeries();
    assert.equal(recovered.ref.etag, delivered.ref.etag);
    assert.equal(recovered.data, delivered.data);
    assert.deepEqual(await rows(), initial, "Adapter evidence alone never acknowledges local family mappings or edits local content");
    assert.deepEqual((await db.select().from(externalEvents).where(eq(externalEvents.eventID, localMaster.id)))[0], familyMapping);
    const occurrenceWrite = prepareCaldavSeriesWrite(comparison.evidence, comparison.baseline, { title: "Only the moved occurrence", location: "Native exception" }, comparison.baseline.children[0]!.id);
    const occurrenceResult = await caldavAdapter.writeCaldavSeries!(userID, account.id, collectionURL, occurrenceWrite);
    assert.equal(occurrenceResult.master.title, "Renamed series");
    assert.equal(occurrenceResult.exceptions[0]!.title, "Only the moved occurrence");
    assert.equal(occurrenceResult.exceptions[0]!.location, "Native exception");
    assert.deepEqual(occurrenceResult.exceptions[0]!.timeModel, delivered.exceptions[0]!.timeModel);
    assert.equal((await caldavAdapter.writeCaldavSeries!(userID, account.id, collectionURL, occurrenceWrite)).ref.etag, occurrenceResult.ref.etag);
    const cancelBaseline = { ...occurrenceWrite.baseline, ref: occurrenceResult.ref, children: occurrenceWrite.baseline.children.map(child => ({ ...child, title: "Only the moved occurrence", location: "Native exception" })) };
    const cancelEvidence = await caldavAdapter.readCaldavSeries!(userID, account.id, collectionURL, cancelBaseline);
    const cancelWrite = prepareCaldavSeriesWrite(cancelEvidence, cancelBaseline, {}, cancelBaseline.children[0]!.id, true);
    const cancelResult = await caldavAdapter.writeCaldavSeries!(userID, account.id, collectionURL, cancelWrite);
    assert.equal(cancelResult.exceptions[0]!.isCanceled, true);
    assert.equal(cancelResult.master.title, occurrenceResult.master.title);
    assert.deepEqual(cancelResult.exceptions[0]!.timeModel, occurrenceResult.exceptions[0]!.timeModel);
    assert.equal((await caldavAdapter.writeCaldavSeries!(userID, account.id, collectionURL, cancelWrite)).ref.etag, cancelResult.ref.etag);
    let generatedBaseline: CaldavSeriesIntent = { ...cancelBaseline, ref: cancelResult.ref, children: cancelBaseline.children.map(child => ({ ...child, isCanceled: true })) };
    for (const cancellation of [false, true]) {
      const definitionID = randomUUID();
      const originalStart = { kind: "instant" as const, value: cancellation ? "2026-03-31T07:00:00.000Z" : "2026-03-30T07:00:00.000Z" };
      const common = { operationID: definitionID, scope: "occurrence" as const, expectedRevision: generatedBaseline.master.revision!, originalStart, expectedOccurrenceRevision: null };
      const patch = cancellation ? {} : { title: "New native definition" };
      const request = cancellation ? { ...common, action: "delete" as const } : { ...common, action: "update" as const, patch, ensureDefinition: true };
      const definition = planEventScope(generatedBaseline.master, generatedBaseline.children, request, () => definitionID).creates[0]!;
      const evidence = await caldavAdapter.readCaldavSeries!(userID, account.id, collectionURL, generatedBaseline);
      const prepared = prepareCaldavSeriesWrite(evidence, generatedBaseline, patch, definitionID, cancellation ? true : undefined, definition);
      const result = await caldavAdapter.writeCaldavSeries!(userID, account.id, collectionURL, prepared);
      const child = result.exceptions.find(item => JSON.stringify(item.originalStart) === JSON.stringify(originalStart))!;
      assert.equal(child.isCanceled, cancellation);
      assert.deepEqual(child.timeModel, definition.timeModel);
      assert.equal(result.exceptions.length, generatedBaseline.children.length + 1);
      assert.equal((await caldavAdapter.writeCaldavSeries!(userID, account.id, collectionURL, prepared)).ref.etag, result.ref.etag);
      generatedBaseline = { ...generatedBaseline, ref: result.ref, children: [...generatedBaseline.children, { ...definition, revision: 1 }] };
    }
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
    const scopedURL = new URL("scoped.ics", collectionURL).href;
    const scopedData = ["BEGIN:VCALENDAR", "VERSION:2.0", master, moved, "END:VCALENDAR"].join("\r\n").split("UID:family").join("UID:scoped");
    const seeded = await davFetch(scopedURL, { method: "PUT", headers: { authorization: basicAuth, "content-type": "text/calendar" }, body: scopedData });
    assert.ok(seeded.ok);
    await sync();
    const scopedRoot = (await rows()).find(event => !event.deletedAt && !event.seriesID)!;
    const scopeRequest = { operationID: randomUUID(), scope: "series", action: "update", expectedRevision: scopedRoot.revision, patch: { title: "Scope through outbox" } };
    const candidate = await applyLocalEventScope(scopedRoot.id, userID, scopeRequest, { prepareProvider: true });
    assert.equal(candidate.status, "caldav_required");
    if (candidate.status !== "caldav_required") throw new Error("Missing scoped context");
    const prepared = await prepareCaldavSeries(candidate.context, scopeRequest);
    const saved = await applyLocalEventScope(scopedRoot.id, userID, scopeRequest, { caldav: prepared });
    assert.equal(saved.status, "saved");
    const [operation] = await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, scopedRoot.id));
    const remoteRead = await davFetch(scopedURL, { headers: { authorization: basicAuth } });
    const remoteBody = (await remoteRead.text()).replace("SUMMARY:Master", "SUMMARY:Concurrent master");
    const remoteWrite = await davFetch(scopedURL, { method: "PUT", headers: { authorization: basicAuth, "content-type": "text/calendar", "If-Match": remoteRead.headers.get("etag")! }, body: remoteBody });
    assert.ok(remoteWrite.ok);
    const conflicted = await deliverEventOutbox(operation.id, () => caldavAdapter);
    assert.equal(conflicted?.status, "conflict");
    const { preview, proof } = await prepareEventDeliveryResolution(userID, scopedRoot.id, operation.id, () => caldavAdapter);
    assert.equal(preview.remote?.title, "Concurrent master"); assert.equal(preview.canResolve, true);
    const replacement = await commitEventDeliveryResolution(userID, proof, { mutationId: randomUUID(), expectedLocalRevision: preview.localRevision, expectedLatestOperationId: preview.latestOperationId, expectedRemoteExists: true, expectedRemoteEtag: preview.remoteEtag });
    const deliveredScope = await deliverEventOutbox(replacement, () => caldavAdapter);
    assert.equal(deliveredScope?.status, "completed");
    const scopedMaps = (await db.select().from(externalEvents).where(eq(externalEvents.calendarID, link.calendarID))).filter(map => map.icalUid === "scoped");
    assert.equal(scopedMaps.length, 2);
    assert.ok(scopedMaps.every(map => map.etag === deliveredScope!.resultRef!.etag));
    const acceptedRows = await rows();
    await sync();
    assert.deepEqual(await rows(), acceptedRows, "Confirmed Radicale echo preserves local revisions and identities");
    const conflictRoot = (await getEventSnapshot(scopedRoot.id))!;
    const conflictChild = (await rows()).find(item => item.seriesID === scopedRoot.id && !item.deletedAt)!;
    const childRequest = { operationID: randomUUID(), scope: "occurrence", action: "update", originalStart: conflictChild.originalStart, expectedOccurrenceRevision: conflictChild.revision, expectedRevision: conflictRoot.revision, patch: { title: "Saved child content" } };
    const childCandidate = await applyLocalEventScope(scopedRoot.id, userID, childRequest, { prepareProvider: true });
    if (childCandidate.status !== "caldav_required") throw new Error("Missing child conflict context");
    const childPrepared = await prepareCaldavSeries(childCandidate.context, childRequest);
    assert.equal((await applyLocalEventScope(scopedRoot.id, userID, childRequest, { caldav: childPrepared })).status, "saved");
    const childOperation = (await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, scopedRoot.id))).find(item => item.mutationID === childRequest.operationID)!;
    const concurrentRead = await davFetch(scopedURL, { headers: { authorization: basicAuth } });
    const concurrentBody = (await concurrentRead.text()).replace("SUMMARY:Moved", "SUMMARY:Remote existing child");
    assert.ok((await davFetch(scopedURL, { method: "PUT", headers: { authorization: basicAuth, "content-type": "text/calendar", "If-Match": concurrentRead.headers.get("etag")! }, body: concurrentBody })).ok);
    assert.equal((await deliverEventOutbox(childOperation.id, () => caldavAdapter))?.status, "conflict");
    const childComparison = await prepareEventDeliveryResolution(userID, scopedRoot.id, childOperation.id, () => caldavAdapter);
    assert.equal(childComparison.preview.remote?.title, "Remote existing child");
    assert.deepEqual(childComparison.preview.remote?.originalStart, conflictChild.originalStart);
    const beforeChildConfirm = await rows();
    const childReplacement = await commitEventDeliveryResolution(userID, childComparison.proof, { mutationId: randomUUID(), expectedLocalRevision: childComparison.preview.localRevision, expectedLatestOperationId: childComparison.preview.latestOperationId, expectedRemoteExists: true, expectedRemoteEtag: childComparison.preview.remoteEtag });
    assert.equal((await deliverEventOutbox(childReplacement, () => caldavAdapter))?.status, "completed");
    assert.deepEqual(await rows(), beforeChildConfirm);
    const afterChildConfirm = await (await davFetch(scopedURL, { headers: { authorization: basicAuth } })).text();
    assert.ok(afterChildConfirm.includes("SUMMARY:Saved child content") && afterChildConfirm.includes("SUMMARY:Scope through outbox") && afterChildConfirm.includes("DESCRIPTION:Keep alarm"));
    await sync(); assert.deepEqual(await rows(), beforeChildConfirm);
    console.log("Radicale existing occurrence content conflict: native CAS, explicit confirmation and stable echo OK");
    for (const cancellation of [false, true]) {
      const current = (await getEventSnapshot(scopedRoot.id))!;
      const originalStart = { kind: "instant", value: cancellation ? "2026-03-31T07:00:00.000Z" : "2026-03-30T07:00:00.000Z" };
      const request = { operationID: randomUUID(), scope: "occurrence", originalStart, expectedOccurrenceRevision: null, expectedRevision: current.revision, ...(cancellation ? { action: "delete" } : { action: "update", patch: { title: "Scoped generated definition" } }) };
      const candidate = await applyLocalEventScope(current.id, userID, request, { prepareProvider: true });
      if (candidate.status !== "caldav_required") throw new Error("Missing generated scope context");
      const prepared = await prepareCaldavSeries(candidate.context, request);
      const saved = await applyLocalEventScope(current.id, userID, request, { caldav: prepared });
      assert.equal(saved.status, "saved");
      const [operation] = (await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, current.id))).filter(item => item.mutationID === request.operationID);
      const nativeRead = await davFetch(scopedURL, { headers: { authorization: basicAuth } });
      const nativeBody = (await nativeRead.text()).replace("END:VCALENDAR", `X-MUSUBI-DEFINITION-CONFLICT:${cancellation ? "cancel" : "create"}\r\nEND:VCALENDAR`);
      assert.ok((await davFetch(scopedURL, { method: "PUT", headers: { authorization: basicAuth, "content-type": "text/calendar", "If-Match": nativeRead.headers.get("etag")! }, body: nativeBody })).ok);
      assert.equal((await deliverEventOutbox(operation.id, () => caldavAdapter))?.status, "conflict");
      const comparison = await prepareEventDeliveryResolution(userID, current.id, operation.id, () => caldavAdapter);
      assert.equal(comparison.preview.local?.isCanceled, cancellation); assert.equal(comparison.preview.remote?.isCanceled, false);
      assert.deepEqual(comparison.preview.remote?.originalStart, originalStart);
      const confirmed = await commitEventDeliveryResolution(userID, comparison.proof, { mutationId: randomUUID(), expectedLocalRevision: comparison.preview.localRevision, expectedLatestOperationId: comparison.preview.latestOperationId, expectedRemoteExists: true, expectedRemoteEtag: comparison.preview.remoteEtag });
      const result = await deliverEventOutbox(confirmed, () => caldavAdapter);
      assert.equal(result?.status, "completed");
      const beforeEcho = await rows();
      const child = beforeEcho.find(item => item.id === prepared.write.newDefinition!.id)!;
      assert.equal(child.isCanceled, cancellation); assert.equal(child.revision, 1);
      await sync(); assert.deepEqual(await rows(), beforeEcho);
      assert.equal((await applyLocalEventScope(current.id, userID, request, { prepareProvider: true })).status, "replayed");
    }
    const cancelledScope = (await rows()).find(item => item.seriesID === scopedRoot.id && item.isCanceled)!;
    const restoreRequest = { operationID: randomUUID(), scope: "occurrence", action: "update", expectedRevision: (await getEventSnapshot(scopedRoot.id))!.revision, originalStart: cancelledScope.originalStart, expectedOccurrenceRevision: cancelledScope.revision, patch: { title: "Restored native occurrence" } };
    const restoreCandidate = await applyLocalEventScope(scopedRoot.id, userID, restoreRequest, { prepareProvider: true });
    if (restoreCandidate.status !== "caldav_required") throw new Error("Missing restoration context");
    const restorePrepared = await prepareCaldavSeries(restoreCandidate.context, restoreRequest);
    assert.equal((await applyLocalEventScope(scopedRoot.id, userID, restoreRequest, { caldav: restorePrepared })).status, "saved");
    const restoreOperation = (await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, scopedRoot.id))).find(item => item.mutationID === restoreRequest.operationID)!;
    const restoreRead = await davFetch(scopedURL, { headers: { authorization: basicAuth } });
    const restoreBody = (await restoreRead.text()).replace("END:VCALENDAR", "X-MUSUBI-REVIVAL-CONFLICT:keep\r\nEND:VCALENDAR");
    assert.ok((await davFetch(scopedURL, { method: "PUT", headers: { authorization: basicAuth, "content-type": "text/calendar", "If-Match": restoreRead.headers.get("etag")! }, body: restoreBody })).ok);
    assert.equal((await deliverEventOutbox(restoreOperation.id, () => caldavAdapter))?.status, "conflict");
    const restoreComparison = await prepareEventDeliveryResolution(userID, scopedRoot.id, restoreOperation.id, () => caldavAdapter);
    assert.equal(restoreComparison.preview.local?.isCanceled, false); assert.equal(restoreComparison.preview.remote?.isCanceled, true);
    const restoreReplacement = await commitEventDeliveryResolution(userID, restoreComparison.proof, { mutationId: randomUUID(), expectedLocalRevision: restoreComparison.preview.localRevision, expectedLatestOperationId: restoreComparison.preview.latestOperationId, expectedRemoteExists: true, expectedRemoteEtag: restoreComparison.preview.remoteEtag });
    assert.equal((await deliverEventOutbox(restoreReplacement, () => caldavAdapter))?.status, "completed");
    const restoredRows = await rows();
    assert.equal(restoredRows.find(item => item.id === cancelledScope.id)!.isCanceled, false);
    await sync(); assert.deepEqual(await rows(), restoredRows);
    const movedTime = { kind: "zoned" as const, timeZone: "Europe/Prague", startLocal: "2026-04-02T12:00:00.000", endLocal: "2026-04-02T13:00:00.000" };
    const timeRequest = { operationID: randomUUID(), scope: "occurrence", action: "update", expectedRevision: (await getEventSnapshot(scopedRoot.id))!.revision, originalStart: cancelledScope.originalStart, expectedOccurrenceRevision: (await getEventSnapshot(cancelledScope.id))!.revision, patch: {}, time: movedTime };
    const timeCandidate = await applyLocalEventScope(scopedRoot.id, userID, timeRequest, { prepareProvider: true });
    if (timeCandidate.status !== "caldav_required") throw new Error("Missing time scope context");
    const timePrepared = await prepareCaldavSeries(timeCandidate.context, timeRequest);
    assert.equal((await applyLocalEventScope(scopedRoot.id, userID, timeRequest, { caldav: timePrepared })).status, "saved");
    const timeOperation = (await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, scopedRoot.id))).find(item => item.mutationID === timeRequest.operationID)!;
    assert.equal((await deliverEventOutbox(timeOperation.id, () => caldavAdapter))?.status, "completed");
    const movedRows = await rows();
    assert.deepEqual(movedRows.find(item => item.id === cancelledScope.id)!.timeModel, movedTime);
    assert.deepEqual(movedRows.find(item => item.id === cancelledScope.id)!.originalStart, cancelledScope.originalStart);
    await sync(); assert.deepEqual(await rows(), movedRows);
    const generatedTimeRequest = { ...timeRequest, operationID: randomUUID(), expectedRevision: (await getEventSnapshot(scopedRoot.id))!.revision, originalStart: { kind: "instant", value: "2026-03-28T08:00:00.000Z" }, expectedOccurrenceRevision: null };
    const generatedTimeCandidate = await applyLocalEventScope(scopedRoot.id, userID, generatedTimeRequest, { prepareProvider: true });
    if (generatedTimeCandidate.status !== "caldav_required") throw new Error("Missing generated time context");
    const generatedTimePrepared = await prepareCaldavSeries(generatedTimeCandidate.context, generatedTimeRequest);
    assert.equal((await applyLocalEventScope(scopedRoot.id, userID, generatedTimeRequest, { caldav: generatedTimePrepared })).status, "saved");
    const generatedTimeOperation = (await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, scopedRoot.id))).find(item => item.mutationID === generatedTimeRequest.operationID)!;
    assert.equal((await deliverEventOutbox(generatedTimeOperation.id, () => caldavAdapter))?.status, "completed");
    const generatedMovedRows = await rows();
    const generatedMoved = generatedMovedRows.find(item => item.id === generatedTimePrepared.write.newDefinition!.id)!;
    assert.deepEqual(generatedMoved.timeModel, movedTime);
    assert.deepEqual(generatedMoved.originalStart, generatedTimeRequest.originalStart);
    await sync(); assert.deepEqual(await rows(), generatedMovedRows);
    const seriesTimeRequest = { operationID: randomUUID(), scope: "series", action: "update", expectedRevision: (await getEventSnapshot(scopedRoot.id))!.revision, patch: {}, time: { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-29T09:00:00.000", endLocal: "2026-03-29T10:00:00.000" } };
    const seriesTimeCandidate = await applyLocalEventScope(scopedRoot.id, userID, seriesTimeRequest, { prepareProvider: true });
    if (seriesTimeCandidate.status !== "caldav_required") throw new Error("Missing series time context");
    const seriesTimePrepared = await prepareCaldavSeries(seriesTimeCandidate.context, seriesTimeRequest);
    assert.equal((await applyLocalEventScope(scopedRoot.id, userID, seriesTimeRequest, { caldav: seriesTimePrepared })).status, "saved");
    const seriesTimeOperation = (await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, scopedRoot.id))).find(item => item.mutationID === seriesTimeRequest.operationID)!;
    assert.equal((await deliverEventOutbox(seriesTimeOperation.id, () => caldavAdapter))?.status, "completed");
    const shiftedRows = await rows();
    for (const old of generatedMovedRows.filter(item => item.seriesID === scopedRoot.id)) {
      const next = shiftedRows.find(item => item.id === old.id)!;
      assert.deepEqual(next.timeModel, old.timeModel); assert.equal(next.title, old.title); assert.equal(next.isCanceled, old.isCanceled);
      assert.notDeepEqual(next.originalStart, old.originalStart);
    }
    await sync(); assert.deepEqual(await rows(), shiftedRows);
    const ruleRequest = { operationID: randomUUID(), scope: "series", action: "update", expectedRevision: (await getEventSnapshot(scopedRoot.id))!.revision, patch: { recurrence: "RRULE:FREQ=DAILY;COUNT=6" } };
    const ruleCandidate = await applyLocalEventScope(scopedRoot.id, userID, ruleRequest, { prepareProvider: true });
    if (ruleCandidate.status !== "caldav_required") throw new Error("Missing recurrence context");
    const rulePrepared = await prepareCaldavSeries(ruleCandidate.context, ruleRequest);
    assert.equal((await applyLocalEventScope(scopedRoot.id, userID, ruleRequest, { caldav: rulePrepared })).status, "saved");
    const ruleOperation = (await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, scopedRoot.id))).find(item => item.mutationID === ruleRequest.operationID)!;
    assert.equal((await deliverEventOutbox(ruleOperation.id, () => caldavAdapter))?.status, "completed");
    const extendedRows = await rows();
    assert.equal(extendedRows.find(item => item.id === scopedRoot.id)!.recurrence, ruleRequest.patch.recurrence);
    assert.deepEqual(extendedRows.filter(item => item.seriesID === scopedRoot.id), shiftedRows.filter(item => item.seriesID === scopedRoot.id));
    await sync(); assert.deepEqual(await rows(), extendedRows);
    const truncateRoot = (await getEventSnapshot(scopedRoot.id))!;
    const truncateChildren = await Promise.all(extendedRows.filter(item => item.seriesID === scopedRoot.id).map(item => getEventSnapshot(item.id)));
    const truncateMap = (await db.select().from(externalEvents).where(eq(externalEvents.eventID, scopedRoot.id)))[0]!;
    const truncateBaseline = { master: truncateRoot, children: truncateChildren.map(item => item!), ref: { externalEventId: truncateMap.externalEventID, etag: truncateMap.etag, icalUid: truncateMap.icalUid } };
    const truncateEvidence = await caldavAdapter.readCaldavSeries!(userID, account.id, collectionURL, truncateBaseline);
    const splitCut = [...truncateBaseline.children].sort((a, b) => a.originalStart!.value.localeCompare(b.originalStart!.value))[1]!;
    const split = prepareCaldavSeriesSplit(truncateEvidence, truncateBaseline, { operationID: randomUUID(), scope: "following", action: "update", expectedRevision: truncateRoot.revision, originalStart: splitCut.originalStart, expectedOccurrenceRevision: splitCut.revision, patch: { title: "Future native family" } });
    const createdSplit = await caldavAdapter.createCaldavSeries!(userID, account.id, collectionURL, split);
    assert.equal(createdSplit.master.title, "Future native family"); assert.equal(createdSplit.exceptions.length, split.creation.children.length);
    const recoveredSplit = await caldavAdapter.createCaldavSeries!(userID, account.id, collectionURL, JSON.parse(JSON.stringify(split)));
    assert.equal(recoveredSplit.ref.etag, createdSplit.ref.etag); assert.deepEqual(await rows(), extendedRows);
    const splitCleanup = await davFetch(split.creation.ref.externalEventId, { method: "DELETE", headers: { authorization: basicAuth, "if-match": recoveredSplit.ref.etag! } });
    assert.ok(splitCleanup.ok); assert.equal((await davFetch(split.creation.ref.externalEventId, { headers: { authorization: basicAuth } })).status, 404);
    const cut = [...truncateBaseline.children].sort((a, b) => b.originalStart!.value.localeCompare(a.originalStart!.value))[0]!;
    const truncateWrite = prepareCaldavSeriesWrite(truncateEvidence, truncateBaseline, {}, undefined, undefined, undefined, undefined, { originalStart: cut.originalStart!, expectedOccurrenceRevision: cut.revision! });
    const truncated = await caldavAdapter.writeCaldavSeries!(userID, account.id, collectionURL, truncateWrite);
    assert.ok(truncated.exceptions.length < truncateChildren.length);
    await caldavAdapter.writeCaldavSeries!(userID, account.id, collectionURL, truncateWrite);
    assert.deepEqual(await rows(), extendedRows, "Native truncation does not yet acknowledge a local scope");
    const restoredTruncation = await davFetch(scopedURL, { method: "PUT", headers: { authorization: basicAuth, "content-type": "text/calendar", "if-match": truncated.ref.etag! }, body: truncateEvidence.data });
    assert.ok(restoredTruncation.ok); await sync(); assert.deepEqual(await rows(), extendedRows);
    const followingRequest = { operationID: randomUUID(), scope: "following", action: "delete", expectedRevision: (await getEventSnapshot(scopedRoot.id))!.revision, originalStart: cut.originalStart, expectedOccurrenceRevision: cut.revision };
    const followingCandidate = await applyLocalEventScope(scopedRoot.id, userID, followingRequest, { prepareProvider: true });
    if (followingCandidate.status !== "caldav_required" || followingCandidate.deleteResource) throw new Error("Missing partial following context");
    const followingPrepared = await prepareCaldavSeries(followingCandidate.context, followingRequest);
    assert.equal((await applyLocalEventScope(scopedRoot.id, userID, followingRequest, { caldav: followingPrepared })).status, "saved");
    const beforeDeletionRows = await rows();
    const followingOperation = (await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, scopedRoot.id))).find(item => item.mutationID === followingRequest.operationID)!;
    assert.equal((await deliverEventOutbox(followingOperation.id, () => caldavAdapter))?.status, "completed");
    await sync(); assert.deepEqual(await rows(), beforeDeletionRows);
    assert.equal((await applyLocalEventScope(scopedRoot.id, userID, followingRequest, { prepareProvider: true })).status, "replayed");
    const deletionRoot = (await getEventSnapshot(scopedRoot.id))!;
    const deletionChildren = await Promise.all((await rows()).filter(item => item.seriesID === scopedRoot.id && !item.deletedAt).map(item => getEventSnapshot(item.id)));
    const deletionMap = (await db.select().from(externalEvents).where(eq(externalEvents.eventID, scopedRoot.id)))[0]!;
    const deletionBaseline = { master: deletionRoot, children: deletionChildren.map(item => item!), ref: { externalEventId: deletionMap.externalEventID, etag: deletionMap.etag, icalUid: deletionMap.icalUid } };
    const deletionEvidence = await caldavAdapter.readCaldavSeriesForDelete!(userID, account.id, collectionURL, deletionBaseline);
    const deletion = prepareCaldavSeriesDeletion(deletionEvidence, deletionBaseline);
    const deletionRequest = { operationID: randomUUID(), scope: "series", action: "delete", expectedRevision: deletionRoot.revision };
    const deletionCandidate = await applyLocalEventScope(scopedRoot.id, userID, deletionRequest, { prepareProvider: true });
    if (deletionCandidate.status !== "caldav_required") throw new Error("Missing deletion scope context");
    const preparedDeletion = await prepareCaldavSeriesDelete(deletionCandidate.context, deletionRequest);
    assert.equal((await applyLocalEventScope(scopedRoot.id, userID, deletionRequest, { caldavDeletion: preparedDeletion })).status, "saved");
    const deletedRows = await rows();
    assert.ok(deletedRows.filter(item => item.id === scopedRoot.id || item.seriesID === scopedRoot.id).every(item => item.deletedAt && item.revision === beforeDeletionRows.find(old => old.id === item.id)!.revision + (beforeDeletionRows.find(old => old.id === item.id)!.deletedAt ? 0 : 1)));
    const deletionOperation = (await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, scopedRoot.id))).find(item => item.mutationID === deletionRequest.operationID)!;
    assert.equal((await deliverEventOutbox(deletionOperation.id, () => caldavAdapter))?.status, "completed");
    assert.equal((await davFetch(scopedURL, { headers: { authorization: basicAuth } })).status, 404);
    assert.equal((await db.select().from(externalEvents)).filter(item => item.externalEventID === scopedURL || item.externalSeriesID === scopedURL).length, 0);
    await caldavAdapter.deleteCaldavSeries!(userID, account.id, collectionURL, deletion);
    await sync(); assert.deepEqual(await rows(), deletedRows);
    assert.equal((await applyLocalEventScope(scopedRoot.id, userID, deletionRequest, { prepareProvider: true })).status, "replayed");
    const journalURL = new URL("split-journal.ics", collectionURL).href;
    const journalSeed = await davFetch(journalURL, { method: "PUT", headers: { authorization: basicAuth, "content-type": "text/calendar", "if-none-match": "*" }, body: truncateEvidence.data.split("UID:scoped").join("UID:split-journal") });
    assert.ok(journalSeed.ok); await sync();
    const journalMapping = (await db.select().from(externalEvents)).find(item => item.externalEventID === journalURL)!;
    const journalRoot = (await getEventSnapshot(journalMapping.eventID))!;
    const journalProbe = await applyLocalEventScope(journalRoot.id, userID, { operationID: randomUUID(), scope: "series", action: "update", expectedRevision: journalRoot.revision, patch: { title: "Probe" } }, { prepareProvider: true });
    if (journalProbe.status !== "caldav_required") throw new Error("Missing private split context");
    const journalBaseline = { master: journalProbe.context.master, children: journalProbe.context.children, ref: { externalEventId: journalURL, etag: journalMapping.etag, icalUid: journalMapping.icalUid } };
    const journalCut = [...journalBaseline.children].sort((a, b) => a.originalStart!.value.localeCompare(b.originalStart!.value))[1]!;
    const journalRequest = { operationID: randomUUID(), scope: "following", action: "update", expectedRevision: journalRoot.revision, originalStart: journalCut.originalStart, expectedOccurrenceRevision: journalCut.revision, patch: { title: "Durable future family" } };
    const journalCandidate = await applyLocalEventScope(journalRoot.id, userID, journalRequest, { prepareProvider: true });
    if (journalCandidate.status !== "caldav_required" || !journalCandidate.splitResource) throw new Error("Missing following split preparation");
    const journalPrepared = await prepareCaldavSplit(journalCandidate.context, journalRequest);
    const journalSplit = journalPrepared.split;
    assert.equal((await applyLocalEventScope(journalRoot.id, userID, journalRequest, { caldavSplit: JSON.parse(JSON.stringify(journalPrepared)) })).status, "saved");
    const journalRows = await rows();
    const journalOperations = (await db.select().from(eventOutbox).where(eq(eventOutbox.mutationID, journalRequest.operationID))).sort((a, b) => a.position - b.position);
    assert.equal(journalOperations.length, 2);
    assert.equal((await deliverEventOutbox(journalOperations[0].id, () => caldavAdapter))?.status, "completed");
    await sync(); assert.deepEqual(await rows(), journalRows);
    assert.equal((await deliverEventOutbox(journalOperations[1].id, () => caldavAdapter))?.status, "completed");
    await sync(); assert.deepEqual(await rows(), journalRows);
    const journalMaps = await db.select().from(externalEvents);
    assert.equal(journalMaps.find(item => item.eventID === journalCut.id)!.externalSeriesID, journalSplit.creation.ref.externalEventId);
    assert.equal(journalMaps.find(item => item.eventID === journalSplit.creation.master.id)!.icalUid, journalSplit.creation.master.id);
    assert.equal((await applyLocalEventScope(journalRoot.id, userID, journalRequest, { prepareProvider: true })).status, "replayed");
    console.log("Radicale durable split source/create ACK and interleaved sync: OK");
    const structuralRoot = (await getEventSnapshot(journalSplit.creation.master.id))!;
    const structuralRequest = { operationID: randomUUID(), scope: "series", action: "update", expectedRevision: structuralRoot.revision, patch: { recurrence: "RRULE:FREQ=DAILY;COUNT=5" }, time: { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-04-02T12:00:00.000", endLocal: "2026-04-02T13:00:00.000" } };
    const structuralCandidate = await applyLocalEventScope(structuralRoot.id, userID, structuralRequest, { prepareProvider: true });
    if (structuralCandidate.status !== "caldav_required") throw new Error("Missing structural resolution context");
    const structuralPrepared = await prepareCaldavSeries(structuralCandidate.context, structuralRequest);
    assert.equal((await applyLocalEventScope(structuralRoot.id, userID, structuralRequest, { caldav: structuralPrepared })).status, "saved");
    const structuralOperation = (await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, structuralRoot.id))).find(item => item.mutationID === structuralRequest.operationID)!;
    const structuralURL = journalSplit.creation.ref.externalEventId;
    const structuralRead = await davFetch(structuralURL, { headers: { authorization: basicAuth } });
    const structuralBody = (await structuralRead.text()).replace("SUMMARY:Durable future family", "SUMMARY:Concurrent structural title");
    assert.ok((await davFetch(structuralURL, { method: "PUT", headers: { authorization: basicAuth, "content-type": "text/calendar", "If-Match": structuralRead.headers.get("etag")! }, body: structuralBody })).ok);
    assert.equal((await deliverEventOutbox(structuralOperation.id, () => caldavAdapter))?.status, "conflict");
    const structuralComparison = await prepareEventDeliveryResolution(userID, structuralRoot.id, structuralOperation.id, () => caldavAdapter);
    assert.equal(structuralComparison.preview.remote?.title, "Concurrent structural title");
    assert.deepEqual(structuralComparison.preview.remote?.timeModel, structuralRoot.timeModel);
    const beforeStructuralConfirm = await rows();
    const structuralReplacement = await commitEventDeliveryResolution(userID, structuralComparison.proof, { mutationId: randomUUID(), expectedLocalRevision: structuralComparison.preview.localRevision, expectedLatestOperationId: structuralComparison.preview.latestOperationId, expectedRemoteExists: true, expectedRemoteEtag: structuralComparison.preview.remoteEtag });
    assert.equal((await deliverEventOutbox(structuralReplacement, () => caldavAdapter))?.status, "completed");
    assert.deepEqual(await rows(), beforeStructuralConfirm);
    await sync(); assert.deepEqual(await rows(), beforeStructuralConfirm);
    console.log("Radicale saved series time/RRULE conflict: complete rekeyed family confirmation and stable echo OK");
    console.log("Radicale scoped transaction, durable worker and atomic family ACK: OK");
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
