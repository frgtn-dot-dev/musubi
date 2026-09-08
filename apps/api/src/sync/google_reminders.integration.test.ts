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
  getEventSnapshot,
  getOwnProviderEventObservation,
  getEventDeliveryResolutionContext,
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

async function main(
  scenario:
    "normal" | "noop-content-conflict" | "recovery-content-conflict" = "normal",
) {
  assert.equal(process.env.ENVIRONMENT, "test");
  const owner = `google-reminder-${randomUUID()}`;
  const credential = issueMemberToken();
  const remote = {
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
        start: new Date(remote.start.dateTime),
        end: new Date(remote.end.dateTime),
        isAllDay: false,
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
    const accepted = await send(first);
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body.status, "pending");
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
    if (scenario === "recovery-content-conflict") {
      remote.summary = "Changed after committed reminder";
      remote.etag = '"remote-title-after-patch"';
      assert.equal(
        (await deliverEventOutbox(second.body.operationID, () => googleAdapter))
          ?.status,
        "conflict",
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
    await assert.rejects(
      getEventDeliveryResolutionContext(
        owner,
        event.id,
        third.body.operationID,
      ),
      /cannot be resolved/,
    );
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
  .finally(() => db.$client.end());
