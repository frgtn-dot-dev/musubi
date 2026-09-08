import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { and, eq, sql } from "drizzle-orm";
import { config } from "@musubi/config";
import { CLIENT_VERSION_HEADER, PRODUCT_VERSION } from "@musubi/types";
import {
  db,
  user,
  account,
  events,
  eventOutbox,
  eventScopeOperations,
  externalEvents,
  externalCalendars,
  createCalendar,
  getEventSnapshot,
  replaceMemberToken,
  upsertExternalEvent,
  commitEventDeliveryResolution,
  getEventDeliveryResolutionReplay,
  EventDeliveryResolutionError,
} from "@musubi/db";
import { normalizeGoogleTime } from "./adapters/google_time";
import { googleEventState } from "./adapters/provider_event_state";
import type { NormalizedEvent } from "./adapter";
import { googleAdapter } from "./adapters/google";
import { deliverEventOutbox } from "./event_delivery";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { prepareEventDeliveryResolution } from "./event_resolution";
import { handlerGetEventDeliveryConflict } from "../handlers/event_delivery";
import { handlerEventScope } from "../handlers/events";

async function main(
  scenario:
    | "series-evidence"
    | "series-evidence-day"
    | "update"
    | "cancel"
    | "ambiguous"
    | "conflict"
    | "resolve-cancel"
    | "meeting"
    | "time"
    | "all-day"
    | "precondition"
    | "floating"
    | "prepare-race"
    | "identity",
) {
  assert.equal(process.env.ENVIRONMENT, "test");
  const seriesEvidence = scenario.startsWith("series-evidence");
  const allDay = scenario === "all-day" || scenario === "series-evidence-day";
  const resolving = scenario === "conflict" || scenario === "resolve-cancel";
  const cancelling = scenario === "cancel" || scenario === "resolve-cancel";
  const owner = `google-scope-${randomUUID()}`;
  const master: any = {
    id: "master",
    etag: '"m1"',
    summary: "Daily focus",
    status: "confirmed",
    start: { dateTime: "2026-09-10T09:00:00Z", timeZone: "Europe/Prague" },
    end: { dateTime: "2026-09-10T10:00:00Z", timeZone: "Europe/Prague" },
    recurrence: ["RRULE:FREQ=DAILY;COUNT=3"],
    organizer: { email: "owner@example.test", self: true },
    reminders: { useDefault: true },
    transparency: "transparent",
    visibility: "private",
  };
  let instance: any = {
    ...structuredClone(master),
    id: "opaque-provider-instance-id",
    etag: '"i1"',
    recurrence: undefined,
    recurringEventId: master.id,
    originalStartTime: { dateTime: "2026-09-11T09:00:00Z" },
    start: { ...master.start, dateTime: "2026-09-11T09:00:00Z" },
    end: { ...master.end, dateTime: "2026-09-11T10:00:00Z" },
  };
  if (cancelling) {
    instance.summary = "Moved exception";
    instance.start.dateTime = "2026-09-11T12:00:00Z";
    instance.end.dateTime = "2026-09-11T13:00:00Z";
  }
  if (allDay) {
    master.start = { date: "2026-09-10" };
    master.end = { date: "2026-09-11" };
    instance.start = { date: "2026-09-11" };
    instance.end = { date: "2026-09-12" };
    instance.originalStartTime = { date: "2026-09-11" };
  }
  if (scenario === "update") instance.status = "tentative";
  const preserved = structuredClone(instance);
  let patches = 0;
  let reads = 0;
  let echo: (() => Promise<void>) | undefined;
  let onInstances: (() => Promise<void>) | undefined;
  let seriesPages: Record<string, any> = {};
  let onPage: (() => void) | undefined;
  const fixture = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://fixture.test");
    res.setHeader("content-type", "application/json");
    const json = (value: unknown) => res.end(JSON.stringify(value));
    assert.equal(req.headers.authorization, "Bearer fixture-access");
    if (req.method === "GET") {
      reads++;
      if (url.pathname.endsWith("/calendarList/source"))
        return json({ accessRole: "owner" });
      if (url.pathname.endsWith("/events/master")) return json(master);
      if (url.pathname.endsWith("/events")) {
        assert.equal(url.searchParams.get("singleEvents"), "false");
        assert.equal(url.searchParams.get("showDeleted"), "true");
        assert.equal(url.searchParams.has("timeMin"), false);
        assert.equal(url.searchParams.has("timeMax"), false);
        if (onPage) onPage();
        return json(seriesPages[url.searchParams.get("pageToken") ?? ""]);
      }
      if (url.pathname.endsWith("/instances")) {
        assert.equal(
          url.searchParams.get("originalStart"),
          allDay ? "2026-09-11" : "2026-09-11T09:00:00.000Z",
        );
        if (onInstances) await onInstances();
        return json({ items: [instance] });
      }
      assert.ok(url.pathname.endsWith("/events/opaque-provider-instance-id"));
      return json(instance);
    }
    assert.equal(req.method, "PATCH");
    assert.ok(url.pathname.endsWith("/events/opaque-provider-instance-id"));
    assert.equal(url.searchParams.get("sendUpdates"), "none");
    assert.equal(req.headers["if-match"], instance.etag);
    let bytes = "";
    for await (const chunk of req) bytes += chunk;
    const patch = JSON.parse(bytes);
    assert.ok(
      Object.keys(patch).every((key) =>
        [
          "summary",
          "description",
          "location",
          "start",
          "end",
          "status",
        ].includes(key),
      ),
    );
    if (scenario === "precondition") {
      res.statusCode = 412;
      return json({ error: "Concurrent provider version" });
    }
    patches++;
    instance = { ...instance, ...patch, etag: '"i2"' };
    if (patch.status === "cancelled")
      instance = {
        id: instance.id,
        etag: instance.etag,
        status: "cancelled",
        recurringEventId: master.id,
        originalStartTime: instance.originalStartTime,
      };
    if (echo) await echo();
    if (scenario === "ambiguous") {
      res.statusCode = 503;
      return json({ error: "committed, response lost" });
    }
    return json(instance);
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const fixtureOrigin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "www.googleapis.com");
    return realFetch(`${fixtureOrigin}${url.pathname}${url.search}`, init);
  };
  const enabled = config.api.eventTimeEditsEnabled;
  const credential = issueMemberToken();
  await db.insert(user).values({
    id: owner,
    name: owner,
    email: `${owner}@example.test`,
    isExternal: true,
  });
  await replaceMemberToken(owner, credential.tokenHash);
  const app = express();
  app.use(express.json());
  app.post("/events/:eventId/scope", requireAuth, handlerEventScope);
  app.get(
    "/events/:eventId/delivery/:operationId/conflict",
    requireAuth,
    handlerGetEventDeliveryConflict,
  );
  app.use(middlewareErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    config.api.eventTimeEditsEnabled = true;
    await db.insert(account).values({
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
    await db.insert(externalCalendars).values({
      provider: "google",
      userID: owner,
      accountID: "fixture",
      calendarID: calendar.id,
      externalCalendarID: "source",
    });
    const observe = async (raw: any) => {
      const base: NormalizedEvent = {
        externalId: raw.id,
        status: "active",
        title: raw.summary ?? "",
        start: new Date(0),
        end: new Date(0),
        isAllDay: false,
        description: raw.description ?? null,
        location: raw.location ?? null,
        organizer: raw.organizer?.email ?? null,
        recurrence: null,
        url: null,
      };
      const normalized = normalizeGoogleTime(
        raw,
        base,
        raw.recurringEventId ? master : undefined,
      );
      await upsertExternalEvent(
        "google",
        owner,
        calendar.id,
        "source",
        raw.id,
        {
          ...normalized,
          organizer: normalized.organizer ?? "owner@example.test",
          color: "red",
        },
        raw.etag,
        null,
        undefined,
        {
          timeModel: normalized.timeModel!,
          externalSeriesID: normalized.externalSeriesID,
          originalStart: normalized.originalStart,
          isCanceled: normalized.isCanceled,
        },
        undefined,
        googleEventState(raw),
      );
    };
    await observe(master);
    if (cancelling) await observe(instance);
    const [mapping] = await db
      .select()
      .from(externalEvents)
      .where(
        and(
          eq(externalEvents.calendarID, calendar.id),
          eq(externalEvents.externalEventID, master.id),
        ),
      );
    const localMaster = (await getEventSnapshot(mapping.eventID))!;
    if (seriesEvidence) {
      const intent = {
        master: localMaster,
        masterExternalID: master.id,
        masterEtag: master.etag,
      };
      const cancellation = {
        id: "cancelled-far-away",
        recurringEventId: master.id,
        status: "cancelled",
        etag: '\"c1\"',
        originalStartTime: allDay
          ? { date: "2028-09-12" }
          : { dateTime: "2028-09-12T09:00:00Z" },
      };
      const moved = {
        ...instance,
        start: allDay
          ? { date: "2026-10-01" }
          : { ...instance.start, dateTime: "2026-10-01T09:00:00Z" },
        end: allDay
          ? { date: "2026-10-02" }
          : { ...instance.end, dateTime: "2026-10-01T10:00:00Z" },
      };
      const normalPages = {
        "": {
          items: [
            master,
            moved,
            { id: "other", recurringEventId: "other-series", attendees: [{}] },
          ],
          nextPageToken: "two",
        },
        two: { items: [cancellation] },
      };
      seriesPages = normalPages;
      const read = () =>
        googleAdapter.readSeries!(owner, "fixture", "source", intent);
      const evidence = await read();
      assert.equal(evidence.master.ref.etag, master.etag);
      assert.equal(evidence.exceptions.length, 2);
      const cancelled = evidence.exceptions.find(
        (item) => item.ref.externalEventId === cancellation.id,
      )!;
      assert.equal(cancelled.event.isCanceled, true);
      assert.equal(
        cancelled.event.originalStart!.value.startsWith("2028-09-12"),
        true,
      );
      const observedMoved = evidence.exceptions.find(
        (item) => item.ref.externalEventId === moved.id,
      )!;
      assert.equal(
        observedMoved.event.start.toISOString().startsWith("2026-10-01"),
        true,
      );
      assert.equal(
        observedMoved.event.originalStart!.value.startsWith("2026-09-11"),
        true,
      );
      assert.deepEqual(observedMoved.state, googleEventState(moved));
      // Live Google evidence (2026-09-08): a child edit does not invalidate the
      // master ETag. A final master GET cannot turn this scan into a family CAS.
      let childPageVisits = 0;
      onPage = () => {
        if (++childPageVisits === 2) {
          moved.summary = "Concurrent exception title";
          moved.etag = '\"concurrent-child\"';
        }
      };
      const staleFamily = await read();
      onPage = undefined;
      assert.equal(staleFamily.master.ref.etag, intent.masterEtag);
      const staleChild = staleFamily.exceptions.find(item => item.ref.externalEventId === moved.id)!;
      assert.equal(staleChild.event.title, observedMoved.event.title);
      assert.equal(staleChild.ref.etag, observedMoved.ref.etag);
      const freshFamily = await read();
      assert.equal(freshFamily.master.ref.etag, staleFamily.master.ref.etag);
      const freshChild = freshFamily.exceptions.find(item => item.ref.externalEventId === moved.id)!;
      assert.equal(freshChild.event.title, "Concurrent exception title");
      assert.notEqual(freshChild.ref.etag, staleChild.ref.etag);

      // Keep the real authenticated endpoint closed even with the time-edit
      // flag enabled. An empty local child list is not a provider family lock.
      for (const withChild of [false, true]) {
        if (withChild) await observe(moved);
        const childrenBefore = await db.select().from(events).where(eq(events.seriesID, localMaster.id));
        const mappingsBefore = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id));
        const beforeSeriesReads = reads;
        const response = await realFetch(`${origin}/events/${localMaster.id}/scope`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential.raw}`,
            "content-type": "application/json",
            [CLIENT_VERSION_HEADER]: PRODUCT_VERSION,
          },
          body: JSON.stringify({
            operationID: randomUUID(),
            expectedRevision: localMaster.revision,
            scope: "series",
            action: "update",
            patch: { title: "Unsafe whole-series rename" },
          }),
        });
        assert.equal(response.status, 403);
        await response.json();
        assert.equal(reads, beforeSeriesReads);
        assert.equal(patches, 0);
        assert.deepEqual(await getEventSnapshot(localMaster.id), localMaster);
        assert.deepEqual(await db.select().from(events).where(eq(events.seriesID, localMaster.id)), childrenBefore);
        assert.deepEqual(await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)), mappingsBefore);
        assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.calendarID, calendar.id))).length, 0);
        assert.equal((await db.select().from(eventScopeOperations).where(eq(eventScopeOperations.eventID, localMaster.id))).length, 0);
      }
      seriesPages = { ...normalPages, two: { items: [moved] } };
      await assert.rejects(read, /conflict/);
      seriesPages = {
        ...normalPages,
        two: { items: [{ ...moved, id: "duplicate-original" }] },
      };
      await assert.rejects(read, /conflict/);
      seriesPages = {
        "": { items: [], nextPageToken: "loop" },
        loop: { items: [], nextPageToken: "loop" },
      };
      await assert.rejects(read, /conflict/);
      seriesPages = { "": { items: null } };
      await assert.rejects(read, /conflict/);
      seriesPages = {
        ...normalPages,
        two: {
          items: [
            {
              ...instance,
              id: "guest",
              attendees: [{ email: "guest@example.test" }],
            },
          ],
        },
      };
      await assert.rejects(read, /Meeting/);
      seriesPages = normalPages;
      let pageVisits = 0;
      onPage = () => {
        if (++pageVisits === 2) master.etag = '\"changed-during-scan\"';
      };
      await assert.rejects(read, /conflict/);
      onPage = undefined;
      master.etag = intent.masterEtag;
      const before = reads;
      config.api.eventTimeEditsEnabled = false;
      await assert.rejects(read);
      assert.equal(reads, before);
      assert.equal(patches, 0);
      assert.deepEqual(await getEventSnapshot(localMaster.id), localMaster);
      console.log(
        `Google series evidence ${allDay ? "all-day" : "zoned"}: unbounded exception pagination, cancellation, identity/permission/refusal and no mutation OK`,
      );
      return;
    }
    const [existing] = await db
      .select()
      .from(events)
      .where(eq(events.seriesID, localMaster.id));
    const request = {
      operationID: randomUUID(),
      expectedRevision: localMaster.revision,
      scope: "occurrence",
      originalStart: allDay
        ? { kind: "date", value: "2026-09-11" }
        : { kind: "instant", value: "2026-09-11T09:00:00.000Z" },
      expectedOccurrenceRevision: existing?.revision ?? null,
      ...(cancelling
        ? { action: "delete" }
        : {
            action: "update",
            patch: { title: "Changed occurrence" },
            ...(scenario === "floating"
              ? {
                  time: {
                    kind: "floating",
                    startLocal: "2026-09-11T11:00:00.000",
                    endLocal: "2026-09-11T12:00:00.000",
                  },
                }
              : scenario === "time"
                ? {
                    time: {
                      kind: "zoned",
                      timeZone: "Europe/Prague",
                      startLocal: "2026-09-11T16:00:00.000",
                      endLocal: "2026-09-11T18:00:00.000",
                    },
                  }
                : allDay
                  ? {
                      time: {
                        kind: "all-day",
                        startDate: "2026-09-12",
                        endDate: "2026-09-13",
                      },
                    }
                  : {}),
          }),
    };
    const send = async () => {
      const response = await realFetch(
        `${origin}/events/${localMaster.id}/scope`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential.raw}`,
            "content-type": "application/json",
            [CLIENT_VERSION_HEADER]: PRODUCT_VERSION,
          },
          body: JSON.stringify(request),
        },
      );
      return { status: response.status, body: await response.json() };
    };
    if (scenario === "prepare-race" || scenario === "identity") {
      if (scenario === "prepare-race")
        onInstances = async () => {
          await db
            .update(events)
            .set({
              title: "Concurrent local title",
              revision: sql`${events.revision} + 1`,
            })
            .where(eq(events.id, localMaster.id));
        };
      else instance.originalStartTime = { dateTime: "2026-09-12T09:00:00Z" };
      assert.equal((await send()).status, 409);
      assert.equal(patches, 0);
      assert.equal(
        (
          await db
            .select()
            .from(events)
            .where(eq(events.seriesID, localMaster.id))
        ).length,
        0,
      );
      assert.equal(
        (
          await db
            .select()
            .from(eventOutbox)
            .where(eq(eventOutbox.calendarID, calendar.id))
        ).length,
        0,
      );
      assert.equal(
        (
          await db
            .select()
            .from(externalEvents)
            .where(eq(externalEvents.calendarID, calendar.id))
        ).length,
        1,
      );
      return;
    }
    if (scenario === "floating") {
      const beforeReads = reads;
      assert.equal((await send()).status, 403);
      assert.equal(reads, beforeReads);
      assert.deepEqual(await getEventSnapshot(localMaster.id), localMaster);
      assert.equal(
        (
          await db
            .select()
            .from(events)
            .where(eq(events.seriesID, localMaster.id))
        ).length,
        0,
      );
      assert.equal(
        (
          await db
            .select()
            .from(eventOutbox)
            .where(eq(eventOutbox.calendarID, calendar.id))
        ).length,
        0,
      );
      assert.equal(
        (
          await db
            .select()
            .from(externalEvents)
            .where(eq(externalEvents.calendarID, calendar.id))
        ).length,
        1,
      );
      return;
    }
    if (scenario === "meeting") {
      master.attendees = [{ email: "other@example.test" }];
      const result = await send();
      assert.equal(result.status, 403);
      assert.equal(patches, 0);
      assert.deepEqual(await getEventSnapshot(localMaster.id), localMaster);
      return;
    }
    const responses = await Promise.all([send(), send()]);
    assert.ok(
      responses.every((response) => response.status === 200),
      JSON.stringify(responses),
    );
    assert.deepEqual(
      responses.map((response) => response.body.replayed).sort(),
      [false, true],
    );
    const [operation] = await db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.mutationID, request.operationID));
    assert.ok(operation.payload.googleOccurrence);
    assert.equal(
      operation.action,
      "update",
      "native generated instance is not a remote create",
    );
    const child = (await getEventSnapshot(operation.eventID))!;
    assert.equal(child.seriesID, localMaster.id);
    assert.equal(child.isCanceled, cancelling);
    assert.equal(
      (await getEventSnapshot(localMaster.id))!.recurrence,
      localMaster.recurrence,
    );
    await observe(instance); // accepted baseline pull before the first attempt
    const [afterBaseline] = await db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.id, operation.id));
    assert.equal(afterBaseline.status, "pending");
    if (resolving) {
      instance.summary = "Concurrent remote change";
      instance.etag = '"remote"';
    } else if (scenario !== "ambiguous")
      echo = async () => {
        await observe(instance);
      };
    const delivered = await deliverEventOutbox(
      operation.id,
      () => googleAdapter,
    );
    assert.equal(
      delivered?.status,
      scenario === "ambiguous"
        ? "unconfirmed"
        : ["conflict", "resolve-cancel", "precondition"].includes(scenario)
          ? "conflict"
          : "completed",
      JSON.stringify(delivered),
    );
    if (scenario === "ambiguous") {
      await db
        .update(eventOutbox)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(eventOutbox.id, operation.id));
      assert.equal(
        (await deliverEventOutbox(operation.id, () => googleAdapter))?.status,
        "completed",
      );
    }
    assert.equal(
      patches,
      ["conflict", "resolve-cancel", "precondition"].includes(scenario) ? 0 : 1,
    );
    if (resolving) {
      const url = `${origin}/events/${child.id}/delivery/${operation.id}/conflict`;
      const previewResponse = await realFetch(url, {
        headers: {
          authorization: `Bearer ${credential.raw}`,
          [CLIENT_VERSION_HEADER]: PRODUCT_VERSION,
        },
      });
      assert.equal(previewResponse.status, 200);
      const preview = (await previewResponse.json()) as any;
      assert.equal(preview.canResolve, true);
      assert.equal(
        preview.local.originalStart.value,
        child.originalStart!.value,
      );
      assert.equal(preview.local.isCanceled, cancelling);
      assert.equal(preview.local.timeModel.kind, "zoned");
      assert.equal(preview.remote.title, "Concurrent remote change");
      const prepared = await prepareEventDeliveryResolution(
        owner,
        child.id,
        operation.id,
        () => googleAdapter,
      );
      const resolution = {
        mutationId: randomUUID(),
        expectedLocalRevision: preview.localRevision,
        expectedLatestOperationId: preview.latestOperationId,
        expectedRemoteExists: true,
        expectedRemoteEtag: preview.remoteEtag,
        expectedMasterRevision: preview.masterRevision,
      };
      await assert.rejects(
        commitEventDeliveryResolution(owner, prepared.proof, {
          ...resolution,
          expectedMasterRevision: undefined,
        }),
        EventDeliveryResolutionError,
      );
      await db
        .update(events)
        .set({ revision: sql`${events.revision} + 1` })
        .where(eq(events.id, localMaster.id));
      await assert.rejects(
        commitEventDeliveryResolution(owner, prepared.proof, resolution),
        EventDeliveryResolutionError,
      );
      await db
        .update(events)
        .set({ revision: preview.masterRevision })
        .where(eq(events.id, localMaster.id));
      instance.etag = '"remote-newer"';
      const changed = await prepareEventDeliveryResolution(
        owner,
        child.id,
        operation.id,
        () => googleAdapter,
      );
      await assert.rejects(
        commitEventDeliveryResolution(owner, changed.proof, resolution),
        EventDeliveryResolutionError,
      );
      instance.etag = preview.remoteEtag;
      const ids = await Promise.all([
        commitEventDeliveryResolution(owner, prepared.proof, resolution),
        commitEventDeliveryResolution(owner, prepared.proof, resolution),
      ]);
      assert.equal(ids[0], ids[1]);
      assert.equal(
        await getEventDeliveryResolutionReplay(
          owner,
          child.id,
          operation.id,
          resolution,
        ),
        ids[0],
      );
      const [replacement] = await db
        .select()
        .from(eventOutbox)
        .where(eq(eventOutbox.id, ids[0]));
      assert.equal(
        replacement.payload.googleOccurrence!.baseline.title,
        "Concurrent remote change",
      );
      assert.equal(replacement.expectedEtag, preview.remoteEtag);
      instance.summary = "Changed again before delivery";
      instance.etag = '\"remote-again\"';
      assert.equal(
        (await deliverEventOutbox(ids[0], () => googleAdapter))?.status,
        "conflict",
      );
      assert.equal(patches, 0);
      const again = await prepareEventDeliveryResolution(
        owner,
        child.id,
        ids[0],
        () => googleAdapter,
      );
      const lastID = await commitEventDeliveryResolution(owner, again.proof, {
        ...resolution,
        mutationId: randomUUID(),
        expectedLatestOperationId: again.preview.latestOperationId,
        expectedRemoteEtag: again.preview.remoteEtag,
      });
      assert.equal(
        (await deliverEventOutbox(lastID, () => googleAdapter))?.status,
        "completed",
      );
      assert.equal(patches, 1);
      assert.equal(instance.status === "cancelled", cancelling);
      if (!cancelling) assert.equal(instance.summary, child.title);
      assert.deepEqual(
        await getEventSnapshot(child.id),
        child,
        "resolution does not mutate the saved draft",
      );
      // Completed replacement releases the old cancelled receipt's family fence.
      request.operationID = randomUUID();
      request.expectedRevision = preview.masterRevision;
      request.expectedOccurrenceRevision = child.revision;
      Object.assign(request, {
        action: "update",
        patch: { title: "Next change after resolution" },
      });
      const next = await send();
      assert.equal(next.status, 200, JSON.stringify(next));
      return;
    }
    if (scenario === "time") {
      assert.equal(instance.start.dateTime, "2026-09-11T14:00:00.000Z");
      assert.equal(instance.end.dateTime, "2026-09-11T16:00:00.000Z");
    }
    if (allDay) {
      assert.deepEqual(instance.start, { date: "2026-09-12" });
      assert.deepEqual(instance.end, { date: "2026-09-14" });
    }
    const beforeReplay = reads;
    assert.equal((await send()).body.replayed, true);
    assert.equal(
      reads,
      beforeReplay,
      "durable replay does not repeat provider preflight",
    );
    assert.equal(
      (await getEventSnapshot(localMaster.id))!.revision,
      localMaster.revision! + 1,
    );
    if (scenario !== "cancel") {
      assert.equal(instance.status, preserved.status);
      assert.deepEqual(instance.reminders, preserved.reminders);
      assert.equal(instance.visibility, preserved.visibility);
      assert.deepEqual(instance.originalStartTime, preserved.originalStartTime);
    }
  } finally {
    config.api.eventTimeEditsEnabled = enabled;
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    await db.delete(user).where(eq(user.id, owner));
  }
  console.log(
    `Google scope ${scenario}: authenticated atomic/replay, baseline/echo pull and conditional recovery OK`,
  );
}
Promise.resolve()
  .then(() => main("series-evidence"))
  .then(() => main("series-evidence-day"))
  .then(() => main("update"))
  .then(() => main("cancel"))
  .then(() => main("ambiguous"))
  .then(() => main("conflict"))
  .then(() => main("resolve-cancel"))
  .then(() => main("meeting"))
  .then(() => main("time"))
  .then(() => main("all-day"))
  .then(() => main("precondition"))
  .then(() => main("floating"))
  .then(() => main("prepare-race"))
  .then(() => main("identity"))
  .finally(() => db.$client.end());
