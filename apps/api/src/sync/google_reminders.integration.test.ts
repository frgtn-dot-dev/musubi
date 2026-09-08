import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { config } from "@musubi/config";
import {
  CLIENT_VERSION_HEADER,
  PRODUCT_VERSION,
  type GoogleReminderWrite,
} from "@musubi/types";
import {
  account,
  db,
  user,
  createCalendar,
  externalCalendars,
  externalEvents,
  eventOutbox,
  events,
  getEventSnapshot,
  getOwnProviderEventObservation,
  commitEventDeliveryResolution,
  replaceMemberToken,
  upsertExternalEvent,
} from "@musubi/db";
import { googleEventState } from "./adapters/provider_event_state";
import { googleAdapter } from "./adapters/google";
import { deliverEventOutbox } from "./event_delivery";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { handlerProviderReminderEdit } from "../handlers/events";
import { handlerGetEventDeliveryConflict, handlerResolveEventDelivery } from "../handlers/event_delivery";
import { prepareEventDeliveryResolution } from "./event_resolution";

async function main(
  scenario:
    "normal" | "noop-content-conflict" | "recovery-content-conflict" | "legacy-detached" | "known-zoned" | "known-all-day" | "known-zone-conflict" | "known-recovery-zone-conflict" | "known-end-zone-conflict" | "known-recovery-end-zone-conflict" | "known-pull-zone-conflict" | "known-pull-reminder-conflict" | "known-pull-echo" = "normal",
) {
  assert.equal(process.env.ENVIRONMENT, "test");
  const owner = `google-reminder-${randomUUID()}`;
  const credential = issueMemberToken();
  const remote: any = {
    id: "meeting",
    etag: '"v1"',
    summary: "Private meeting",
    start: { dateTime: "2026-09-10T09:00:00Z" },
    end: { dateTime: "2026-09-10T10:00:00Z" },
    organizer: { email: "organizer@example.test", self: false },
    attendees: [
      { email: "guest@example.test", self: true, responseStatus: "accepted" },
    ],
    conferenceData: {
      entryPoints: [{ uri: "https://meet.example.test/fixture" }],
    },
    visibility: "private",
    transparency: "opaque",
    reminders: { useDefault: true } as {
      useDefault: boolean;
      overrides?: { method: string; minutes: number }[];
    },
  };
  if (scenario.startsWith("known-")) {
    remote.start.timeZone = "Europe/Prague"; remote.end.timeZone = "Europe/Prague";
    if (scenario === "known-all-day") { remote.start = { date: "2026-09-10" }; remote.end = { date: "2026-09-11" }; }
  }
  const unchanged = structuredClone(remote);
  let requests = 0;
  let patches = 0;
  let ambiguous = false;
  let omitEtag = false;
  let omitTime = false;
  const fixture = createServer(async (req, res) => {
    requests++;
    const url = new URL(req.url!, "http://fixture.test");
    res.setHeader("content-type", "application/json");
    const json = (body: unknown) => res.end(JSON.stringify(body));
    assert.equal(req.headers.authorization, "Bearer fixture-access");
    if (url.pathname.endsWith("/calendarList/source")) {
      assert.equal(req.method, "GET");
      return json({ accessRole: "owner" });
    }
    if (url.pathname === "/calendar/v3/calendars/source/events") return json({ items: [remote], nextSyncToken: "next" });
    assert.equal(url.pathname, "/calendar/v3/calendars/source/events/meeting");
    if (req.method === "GET") return json(remote);
    assert.equal(req.method, "PATCH");
    assert.equal(req.headers["if-match"], remote.etag);
    assert.equal(url.searchParams.get("sendUpdates"), "none");
    let bytes = "";
    for await (const chunk of req) bytes += chunk;
    const body = JSON.parse(bytes);
    assert.deepEqual(Object.keys(body), ["reminders"]);
    patches++;
    remote.reminders = body.reminders;
    remote.etag = `"v${patches + 1}"`;
    if (ambiguous) {
      ambiguous = false;
      res.statusCode = 503;
      return json({ error: { message: "Committed, response lost" } });
    }
    if (omitTime) {
      omitTime = false;
      const { start: _start, ...body } = remote;
      return json(body);
    }
    if (omitEtag) {
      omitEtag = false;
      const { etag: _etag, ...body } = remote;
      return json(body);
    }
    return json(remote);
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const fixtureOrigin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    assert.equal(
      url.hostname,
      "www.googleapis.com",
      "No real provider request allowed",
    );
    return realFetch(`${fixtureOrigin}${url.pathname}${url.search}`, init);
  };
  const enabled = config.api.providerReminderEditsEnabled;
  const timeEnabled = config.api.eventTimeEditsEnabled;
  await db
    .insert(user)
    .values({
      id: owner,
      name: owner,
      email: `${owner}@example.test`,
      isExternal: true,
    });
  await replaceMemberToken(owner, credential.tokenHash);
  const app = express();
  app.use(express.json());
  app.post(
    "/events/:eventId/provider-reminders",
    requireAuth,
    handlerProviderReminderEdit,
  );
  app.get("/events/:eventId/delivery/:operationId/conflict", requireAuth, handlerGetEventDeliveryConflict);
  app.post("/events/:eventId/delivery/:operationId/resolve", requireAuth, handlerResolveEventDelivery);
  app.use(middlewareErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await db
      .insert(account)
      .values({
        id: randomUUID(),
        userId: owner,
        providerId: "google",
        accountId: "fixture",
        scope: "https://www.googleapis.com/auth/calendar.events",
        accessToken: "fixture-access",
        refreshToken: "fixture-refresh",
        accessTokenExpiresAt: new Date(Date.now() + 3600000),
      });
    const calendar = await createCalendar({
      creatorID: owner,
      name: "Google",
      color: "red",
    });
    await db
      .insert(externalCalendars)
      .values({
        provider: "google",
        userID: owner,
        accountID: "fixture",
        calendarID: calendar.id,
        externalCalendarID: "source",
      });
    await upsertExternalEvent(
      "google",
      owner,
      calendar.id,
      "source",
      remote.id,
      {
        title: remote.summary,
        color: "red",
        start: new Date(remote.start.dateTime ?? "2026-09-10T00:00:00Z"),
        end: new Date(remote.end.dateTime ?? "2026-09-10T00:00:00Z"),
        isAllDay: !!remote.start.date,
        description: null,
        location: null,
        organizer: remote.organizer.email,
        recurrence: null,
        url: null,
      },
      remote.etag,
      null,
      undefined,
      undefined,
      undefined,
      googleEventState(remote),
    );
    const [mapping] = await db
      .select()
      .from(externalEvents)
      .where(eq(externalEvents.calendarID, calendar.id));
    if (scenario.startsWith("known-")) await db.update(events).set({ timeModel: scenario === "known-all-day" ? { kind: "all-day" } : { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-09-10T11:00:00.000", endLocal: "2026-09-10T12:00:00.000" } }).where(eq(events.id, mapping.eventID));
    const event = (await getEventSnapshot(mapping.eventID))!;
    const send = async (body: unknown) => {
      const response = await realFetch(
        `${origin}/events/${event.id}/provider-reminders`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential.raw}`,
            "content-type": "application/json",
            [CLIENT_VERSION_HEADER]: PRODUCT_VERSION,
          },
          body: JSON.stringify(body),
        },
      );
      return { status: response.status, body: await response.json() };
    };
    const intent = async (reminders: GoogleReminderWrite) => ({
      provider: "google",
      operationID: randomUUID(),
      expectedRevision: event.revision,
      expectedStateVersion: (
        await getOwnProviderEventObservation(owner, event.id)
      ).version,
      reminders,
    });
    const first = await intent({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 15 }],
    });
    config.api.providerReminderEditsEnabled = false;
    assert.equal((await send(first)).status, 403);
    await assert.rejects(
      googleAdapter.writeReminders!(
        owner,
        "fixture",
        "source",
        { externalEventId: remote.id, etag: remote.etag },
        first.reminders,
      ),
    );
    assert.equal(requests, 0, "disabled feature must make no provider request");
    config.api.providerReminderEditsEnabled = true;
    if (scenario === "legacy-detached") {
      const queued = await send(first);
      Object.assign(remote, { recurringEventId: "master", originalStartTime: remote.start });
      const blocked = await deliverEventOutbox(queued.body.operationID, () => googleAdapter);
      assert.equal(blocked?.status, "blocked");
      assert.equal(patches, 0, "legacy exception identity cannot become a native one-off write");
      const [retained] = await db.select().from(externalEvents).where(eq(externalEvents.id, mapping.id));
      assert.equal(retained.etag, '"v1"');
      await assert.rejects(googleAdapter.writeReminders!(owner, "fixture", "source", { externalEventId: remote.id, etag: remote.etag }, first.reminders), /unsupported/);
      assert.equal(patches, 0);
      return;
    }
    const accepted = await send(first);
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body.status, "pending");
    if (scenario === "known-zone-conflict" || scenario === "known-end-zone-conflict") {
      // Same civil minutes and instants, different zone. Even a reused ETag
      // cannot turn that version into evidence for the saved explicit model.
      remote.end.timeZone = "Europe/Berlin";
      if (scenario === "known-zone-conflict") remote.start.timeZone = "Europe/Berlin";
      assert.equal((await deliverEventOutbox(accepted.body.operationID, () => googleAdapter))?.status, scenario === "known-zone-conflict" ? "conflict" : "blocked");
      assert.equal(patches, 0); assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.id, mapping.id)))[0].etag, '"v1"'); return;
    }
    if (scenario.startsWith("known-pull-")) {
      const concurrent = { ...googleAdapter, async writeReminders(...args: Parameters<NonNullable<typeof googleAdapter.writeReminders>>) {
        const observed = await googleAdapter.writeReminders!(...args);
        // Exercise the real fetch adapter with independent flags, not a
        // fabricated timeModel which the disabled importer never supplies.
        config.api.eventTimeEditsEnabled = false;
        if (scenario === "known-pull-zone-conflict") { remote.start.timeZone = "Europe/Berlin"; remote.end.timeZone = "Europe/Berlin"; }
        if (scenario === "known-pull-reminder-conflict") remote.reminders = { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] };
        if (scenario !== "known-pull-echo") remote.etag = '"concurrent-pull"';
        const fetched = await googleAdapter.fetchChanges(owner, "fixture", "source", "old");
        const change = fetched.changes[0]; assert.equal(change.kind, "event");
        if (change.kind !== "event") throw new Error("Expected event");
        const pulled = change.data;
        assert.equal(pulled.timeModel, undefined, "reminder flag cannot enable canonical time adoption");
        assert.ok(pulled.reminderTimeEvidence);
        await upsertExternalEvent("google", owner, calendar.id, "source", remote.id,
          { title: pulled.title, color: event.color, start: pulled.start, end: pulled.end, isAllDay: pulled.isAllDay, description: pulled.description, location: pulled.location, organizer: pulled.organizer ?? "", recurrence: pulled.recurrence, url: pulled.url },
          pulled.etag, null, undefined, undefined, undefined, pulled.providerState, pulled.reminderTimeEvidence);
        return observed;
      } };
      const settled = await deliverEventOutbox(accepted.body.operationID, () => concurrent);
      assert.equal(settled?.status, scenario === "known-pull-echo" ? "completed" : "conflict"); assert.equal(patches, 1);
      const [retained] = await db.select().from(externalEvents).where(eq(externalEvents.id, mapping.id));
      assert.equal(retained.etag, scenario === "known-pull-echo" ? '"v2"' : '"v1"');
      assert.deepEqual(await getEventSnapshot(event.id), event);
      if (scenario !== "known-pull-echo") { assert.ok(settled?.remoteSnapshot && !settled.remoteSnapshot.isEcho); assert.equal(settled.remoteSnapshot.etag, '"concurrent-pull"'); }
      console.log(`Google known-time pending pull ${scenario}: OK`); return;
    }
    const saved = await deliverEventOutbox(
      accepted.body.operationID,
      () => googleAdapter,
    );
    assert.equal(saved?.status, "completed");
    assert.equal(patches, 1);
    assert.deepEqual(
      (await getOwnProviderEventObservation(owner, event.id)).state?.reminders,
      { provider: "google", ...first.reminders },
    );
    assert.deepEqual(await getEventSnapshot(event.id), event);
    assert.equal((await send(first)).body.status, "completed");
    assert.equal(patches, 1);
    if (scenario === "noop-content-conflict") {
      const queued = await send(await intent(first.reminders));
      remote.summary = "Concurrent remote title";
      remote.etag = '"remote-title"';
      assert.equal(
        (await deliverEventOutbox(queued.body.operationID, () => googleAdapter))
          ?.status,
        "conflict",
      );
      const [retained] = await db
        .select()
        .from(externalEvents)
        .where(eq(externalEvents.id, mapping.id));
      assert.equal(
        retained.etag,
        '"v2"',
        "native no-op must not accept an unseen content version",
      );
      await assert.rejects(prepareEventDeliveryResolution(owner, event.id, queued.body.operationID, () => googleAdapter));
      assert.equal(patches, 1);
      assert.deepEqual(await getEventSnapshot(event.id), event);
      return;
    }
    ambiguous = true;
    const second = await send(
      await intent({ useDefault: false, overrides: [] }),
    );
    assert.equal(
      (await deliverEventOutbox(second.body.operationID, () => googleAdapter))
        ?.status,
      "unconfirmed",
    );
    assert.equal(patches, 2);
    await db
      .update(eventOutbox)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(eventOutbox.id, second.body.operationID));
    if (scenario === "recovery-content-conflict" || scenario === "known-recovery-zone-conflict" || scenario === "known-recovery-end-zone-conflict") {
      if (scenario === "known-recovery-end-zone-conflict") remote.end.timeZone = "Europe/Berlin";
      else if (scenario === "known-recovery-zone-conflict") remote.start.timeZone = remote.end.timeZone = "Europe/Berlin";
      else remote.summary = "Changed after committed reminder";
      remote.etag = '"remote-title-after-patch"';
      assert.equal(
        (await deliverEventOutbox(second.body.operationID, () => googleAdapter))
          ?.status,
        scenario === "known-recovery-end-zone-conflict" ? "blocked" : "conflict",
      );
      const [retained] = await db
        .select()
        .from(externalEvents)
        .where(eq(externalEvents.id, mapping.id));
      assert.equal(retained.etag, '"v2"');
      assert.equal(patches, 2);
      return;
    }
    assert.equal(
      (await deliverEventOutbox(second.body.operationID, () => googleAdapter))
        ?.status,
      "completed",
    );
    assert.equal(
      patches,
      2,
      "retry recovers committed preference without another PATCH",
    );
    omitEtag = true;
    const missingTag = await send(
      await intent({
        useDefault: false,
        overrides: [{ method: "email", minutes: 30 }],
      }),
    );
    const uncertain = await deliverEventOutbox(
      missingTag.body.operationID,
      () => googleAdapter,
    );
    assert.equal(
      uncertain?.status,
      "unconfirmed",
      "successful PATCH without ETag must reconcile",
    );
    await db
      .update(eventOutbox)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(eventOutbox.id, missingTag.body.operationID));
    assert.equal(
      (
        await deliverEventOutbox(
          missingTag.body.operationID,
          () => googleAdapter,
        )
      )?.status,
      "completed",
    );
    assert.equal(
      patches,
      3,
      "missing success ETag recovery must not repeat PATCH",
    );
    omitTime = true;
    const missingTime = await send(
      await intent({ useDefault: false, overrides: [] }),
    );
    assert.equal(
      (
        await deliverEventOutbox(
          missingTime.body.operationID,
          () => googleAdapter,
        )
      )?.status,
      "unconfirmed",
    );
    await db
      .update(eventOutbox)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(eventOutbox.id, missingTime.body.operationID));
    assert.equal(
      (
        await deliverEventOutbox(
          missingTime.body.operationID,
          () => googleAdapter,
        )
      )?.status,
      "completed",
    );
    assert.equal(
      patches,
      4,
      "malformed success evidence must recover without another PATCH",
    );
    const third = await send(await intent({ useDefault: true }));
    remote.etag = '"remote-change"';
    assert.equal(
      (await deliverEventOutbox(third.body.operationID, () => googleAdapter))
        ?.status,
      "conflict",
    );
    assert.equal(patches, 4);
    const resolutionHTTP = async (action: "conflict" | "resolve", body?: unknown) => {
      const response = await realFetch(`${origin}/events/${event.id}/delivery/${third.body.operationID}/${action}`, {
        method: action === "conflict" ? "GET" : "POST", headers: { authorization: `Bearer ${credential.raw}`, "content-type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      return { status: response.status, body: await response.json() };
    };
    config.api.providerReminderEditsEnabled = false;
    assert.equal((await resolutionHTTP("conflict")).status, 409);
    config.api.providerReminderEditsEnabled = true;
    const preview = await resolutionHTTP("conflict");
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body.reminderResolution.desired, { useDefault: true });
    assert.deepEqual(preview.body.reminderResolution.remote, { provider: "google", useDefault: false, overrides: [] });
    const request = {
      mutationId: randomUUID(), expectedLocalRevision: event.revision,
      expectedLatestOperationId: third.body.operationID, expectedRemoteExists: true,
      expectedRemoteEtag: preview.body.remoteEtag,
      expectedReminderStateVersion: preview.body.reminderResolution.stateVersion,
    };
    const { expectedReminderStateVersion: _omitted, ...oldClientRequest } = request;
    assert.equal((await resolutionHTTP("resolve", oldClientRequest)).status, 409, "a content-only confirmation cannot authorize reminder replacement");
    remote.reminders = { useDefault: false, overrides: [{ method: "popup", minutes: 7 }] };
    assert.equal((await resolutionHTTP("resolve", request)).status, 409, "same-ETag personal changes invalidate the exact preview");
    const latest = await resolutionHTTP("conflict");
    request.expectedReminderStateVersion = latest.body.reminderResolution.stateVersion;
    const prepared = await prepareEventDeliveryResolution(owner, event.id, third.body.operationID, () => googleAdapter);
    await db.update(events).set({ revision: event.revision + 1 }).where(eq(events.id, event.id));
    await assert.rejects(commitEventDeliveryResolution(owner, prepared.proof, request));
    await db.update(events).set({ revision: event.revision, updatedAt: event.updatedAt }).where(eq(events.id, event.id));
    assert.equal(patches, 4, "preview and stale confirmations are read-only");
    const confirmed = await Promise.all([resolutionHTTP("resolve", request), resolutionHTTP("resolve", request)]);
    assert.deepEqual(confirmed.map(item => item.status), [202, 202]);
    const replacements = (await db.select().from(eventOutbox).where(eq(eventOutbox.mutationID, request.mutationId)));
    assert.equal(replacements.length, 1);
    const replacement = replacements[0];
    assert.deepEqual(replacement.payload.reminderEdit?.reminders, { useDefault: true });
    assert.deepEqual(replacement.payload.patch, {});
    let settled;
    for (let attempt = 0; attempt < 100; attempt++) {
      settled = (await db.select().from(eventOutbox).where(eq(eventOutbox.id, replacement.id)))[0];
      if (settled.status === "completed") break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(settled?.status, "completed");
    assert.equal(patches, 5);
    assert.equal((await resolutionHTTP("resolve", request)).status, 202);
    assert.equal((await resolutionHTTP("resolve", { ...request, expectedReminderStateVersion: "0".repeat(64) })).status, 409);
    assert.deepEqual(await getEventSnapshot(event.id), event);
    const next = await send(await intent({ useDefault: false, overrides: [] }));
    assert.equal(next.status, 202, "confirmed resolution does not strand the next personal edit");
    assert.equal((await deliverEventOutbox(next.body.operationID, () => googleAdapter))?.status, "completed");
    const {
      reminders: _initialReminder,
      etag: _initialTag,
      ...originalContent
    } = unchanged;
    const {
      reminders: _finalReminder,
      etag: _finalTag,
      ...finalContent
    } = remote;
    assert.deepEqual(
      finalContent,
      originalContent,
      "time, attendees, organizer, meeting URL and privacy survive",
    );
  } finally {
    config.api.providerReminderEditsEnabled = enabled;
    config.api.eventTimeEditsEnabled = timeEnabled;
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    await db.delete(user).where(eq(user.id, owner));
  }
  console.log(
    "Google native reminders: gated authenticated enqueue, exact conditional PATCH, guest-copy preservation, replay and 503 recovery: OK",
  );
}
main()
  .then(() => main("noop-content-conflict"))
  .then(() => main("recovery-content-conflict"))
  .then(() => main("legacy-detached"))
  .then(() => main("known-zoned"))
  .then(() => main("known-all-day"))
  .then(() => main("known-zone-conflict"))
  .then(() => main("known-recovery-zone-conflict"))
  .then(() => main("known-end-zone-conflict"))
  .then(() => main("known-recovery-end-zone-conflict"))
  .then(() => main("known-pull-zone-conflict"))
  .then(() => main("known-pull-reminder-conflict"))
  .then(() => main("known-pull-echo"))
  .finally(() => db.$client.end());
