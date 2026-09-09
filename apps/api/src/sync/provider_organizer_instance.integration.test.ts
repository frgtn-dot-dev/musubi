import { verifyOrganizerDispatchLocks } from "./provider_organizer_lock.fixture";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { and, eq } from "drizzle-orm";
import { config } from "@musubi/config";
import {
  CLIENT_VERSION_HEADER,
  PRODUCT_VERSION,
  EventSchema,
} from "@musubi/types";
import {
  db,
  user,
  account,
  events,
  externalCalendars,
  externalEvents,
  eventOutbox,
  calendarMembers,
  createCalendar,
  upsertExternalEvent,
  getEventSnapshot,
  replaceMemberToken,
  requestEventDeliveryRetry,
  deleteExternalEvent,
  claimEventOutbox,
} from "@musubi/db";
import { googleEventState } from "./adapters/provider_event_state";
import { googleAdapter, fetchGoogleChanges } from "./adapters/google";
import { deliverEventOutbox } from "./event_delivery";
import {
  handlerGetProviderEventState,
  handlerProviderOrganizer,
} from "../handlers/events";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { issueMemberToken } from "../federation_tokens";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const old = config.api.providerOrganizerEditsEnabled,
    realFetch = globalThis.fetch;
  let listing: any[] = [];
  let native: any,
    writes = 0,
    lost = false,
    operation = "";
  let onRead: (() => Promise<void>) | undefined,
    onWrite: (() => Promise<void>) | undefined;
  const fixture = createServer(async (req, res) => {
    try {
      assert.equal(
        req.headers.authorization,
        "Bearer synthetic-organizer-instance",
      );
      res.setHeader("Content-Type", "application/json");
      const url = new URL(req.url!, "http://fixture");
      if (url.pathname.endsWith("calendarList/primary")) {
        res.end(
          JSON.stringify({
            id: "owner@example.test",
            primary: true,
            accessRole: "owner",
          }),
        );
        return;
      }
      if (req.method === "GET" && url.pathname.endsWith("/events")) {
        res.end(
          JSON.stringify({
            items: listing,
            nextSyncToken: "cancellation-observed",
          }),
        );
        return;
      }
      assert.equal(
        url.pathname,
        "/calendar/v3/calendars/owner%40example.test/events/instance",
      );
      if (req.method === "GET") {
        if (onRead) {
          const run = onRead;
          onRead = undefined;
          await run();
        }
        if (!native) {
          res.statusCode = 404;
          res.end();
        } else res.end(JSON.stringify(native));
        return;
      }
      const [row] = await db
        .select()
        .from(eventOutbox)
        .where(eq(eventOutbox.id, operation));
      assert.ok(
        row?.payload.organizer?.dispatch,
        "Immutable dispatch marker precedes HTTP",
      );
      assert.equal(url.searchParams.get("sendUpdates"), "all");
      assert.equal(req.headers["if-match"], native.etag);
      let body = "";
      for await (const chunk of req) body += chunk;
      if (req.method === "PATCH") {
        assert.deepEqual(JSON.parse(body), { summary: "Changed occurrence" });
        native = { ...native, summary: "Changed occurrence", etag: '"next"' };
      } else {
        assert.equal(req.method, "DELETE");
        assert.equal(body, "");
        native = null;
      }
      writes++;
      if (onWrite) {
        const run = onWrite;
        onWrite = undefined;
        await run();
      }
      if (lost) {
        req.socket.destroy();
        return;
      }
      res.statusCode = native ? 200 : 204;
      res.end(native ? JSON.stringify(native) : undefined);
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  assert.ok(address && typeof address !== "string");
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://www.googleapis.com", "No live requests");
    return realFetch(
      `http://127.0.0.1:${address.port}${url.pathname}${url.search}`,
      init,
    );
  };
  const app = express();
  app.use(express.json());
  app.get(
    "/api/v1/events/:eventId/provider-state",
    requireAuth,
    handlerGetProviderEventState,
  );
  app.post("/api/v1/provider-organizer", requireAuth, handlerProviderOrganizer);
  app.use(middlewareErrorHandler);
  const api = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => api.once("listening", resolve));
  const apiAddress = api.address();
  assert.ok(apiAddress && typeof apiAddress !== "string");
  const origin = `http://127.0.0.1:${apiAddress.port}`;
  try {
    for (const allDay of [false, true])
      for (const scenario of [
        "mark-parent-revision",
        "mark-parent-mapping",
        "update",
        "delete",
        "delete-pull-before-ack",
        "delete-foreign-before-ack",
        "delete-foreign-parent-lock",
        "delete-active-before-ack",
        "update-lost",
        "delete-lost",
        "parent-stale-observation",
        "parent-before-commit",
        "parent-map-before-commit",
        "parent-pending",
        "parent-cancelled",
        "native-parent",
        "native-original",
        "parent-before-dispatch",
        "parent-after-dispatch",
        "map-after-dispatch",
        "grant-after-dispatch",
        "lease-after-dispatch",
        "account-before-dispatch",
        "source-before-dispatch",
        "cancelled-child",
        "missing-scope",
        "time-patch",
        "master",
        "generated",
      ]) {
        config.api.providerOrganizerEditsEnabled = true;
        writes = 0;
        lost = scenario.endsWith("-lost");
        onRead = undefined;
        onWrite = undefined;
        const owner = `organizer-instance-${randomUUID()}`;
        await db.insert(user).values({
          id: owner,
          name: "Owner",
          email: `${owner}@example.test`,
          isExternal: true,
        });
        try {
          await db.insert(account).values({
            id: randomUUID(),
            userId: owner,
            providerId: "google",
            accountId: "fixture",
            scope: "https://www.googleapis.com/auth/calendar.events",
            accessToken: "synthetic-organizer-instance",
            refreshToken: "synthetic-refresh",
            accessTokenExpiresAt: new Date(Date.now() + 3600000),
          });
          const calendar = await createCalendar({
            creatorID: owner,
            name: "Instance organizer",
            color: "red",
          });
          const [link] = await db
            .insert(externalCalendars)
            .values({
              provider: "google",
              userID: owner,
              accountID: "fixture",
              calendarID: calendar.id,
              externalCalendarID: "owner@example.test",
            })
            .returning();
          const originalStart = allDay
            ? { kind: "date" as const, value: "2026-10-24" }
            : { kind: "instant" as const, value: "2026-10-24T08:00:00.000Z" };
          native = {
            id: "instance",
            etag: '"child"',
            iCalUID: "family-uid",
            status: "confirmed",
            summary: "Occurrence",
            description: "Notes",
            location: "Room",
            recurringEventId: "series",
            originalStartTime: allDay
              ? { date: "2026-10-24" }
              : {
                  dateTime: "2026-10-24T10:00:00+02:00",
                  timeZone: "Europe/Prague",
                },
            start: allDay
              ? { date: "2026-10-25" }
              : { dateTime: "2026-10-25T09:00:00Z", timeZone: "Europe/Prague" },
            end: allDay
              ? { date: "2026-10-26" }
              : { dateTime: "2026-10-25T10:00:00Z", timeZone: "Europe/Prague" },
            organizer: { email: "owner@example.test", self: true },
            attendees: [
              {
                email: "guest@example.test",
                responseStatus: "accepted",
                comment: "preserve",
              },
            ],
            nativeExtension: { untouched: true },
          };
          const initialNative = structuredClone(native),
            state = googleEventState(native);
          const values = {
            title: "Occurrence",
            color: "red",
            start: new Date(
              allDay ? "2026-10-25T00:00:00Z" : "2026-10-25T09:00:00Z",
            ),
            end: new Date(
              allDay ? "2026-10-25T00:00:00Z" : "2026-10-25T10:00:00Z",
            ),
            isAllDay: allDay,
            description: "Notes",
            location: "Room",
            organizer: "owner@example.test",
            recurrence: null,
            url: null,
          };
          const model = allDay
            ? { kind: "all-day" as const }
            : {
                kind: "zoned" as const,
                timeZone: "Europe/Prague",
                startLocal: "2026-10-25T10:00:00.000",
                endLocal: "2026-10-25T11:00:00.000",
              };
          await upsertExternalEvent(
            "google",
            owner,
            calendar.id,
            "owner@example.test",
            "series",
            {
              ...values,
              title: "Series",
              start: new Date(
                allDay ? "2026-10-24T00:00:00Z" : "2026-10-24T08:00:00Z",
              ),
              end: new Date(
                allDay ? "2026-10-24T00:00:00Z" : "2026-10-24T09:00:00Z",
              ),
              recurrence: "RRULE:FREQ=DAILY;COUNT=4",
            },
            '"parent"',
            "family-uid",
            undefined,
            {
              timeModel: allDay
                ? model
                : {
                    kind: "zoned",
                    timeZone: "Europe/Prague",
                    startLocal: "2026-10-24T10:00:00.000",
                    endLocal: "2026-10-24T11:00:00.000",
                  },
            },
            undefined,
            state,
          );
          await upsertExternalEvent(
            "google",
            owner,
            calendar.id,
            "owner@example.test",
            "instance",
            values,
            native.etag,
            "family-uid",
            undefined,
            { timeModel: model, externalSeriesID: "series", originalStart },
            undefined,
            state,
          );
          const maps = await db
            .select()
            .from(externalEvents)
            .where(eq(externalEvents.calendarID, calendar.id));
          const mapping = maps.find((m) => m.externalEventID === "instance")!,
            parentMap = maps.find((m) => m.externalEventID === "series")!;
          const child = (await getEventSnapshot(mapping.eventID))!,
            parent = (await getEventSnapshot(parentMap.eventID))!;
          const credential = issueMemberToken();
          await replaceMemberToken(owner, credential.tokenHash);
          const headers = {
            authorization: `Bearer ${credential.raw}`,
            [CLIENT_VERSION_HEADER]: PRODUCT_VERSION,
            "Content-Type": "application/json",
          };
          const observationResponse = await realFetch(
            `${origin}/api/v1/events/${child.id}/provider-state`,
            { headers },
          );
          assert.equal(observationResponse.status, 200);
          const observation = await observationResponse.json();
          assert.equal(
            observation.organizerEdit?.scope,
            "occurrence",
            JSON.stringify(observation),
          );
          assert.match(
            observation.organizerEdit.instanceVersion,
            /^[0-9a-f]{64}$/,
          );
          operation = randomUUID();
          const action = scenario.startsWith("delete") ? "delete" : "update";
          const request: any = {
            provider: "google",
            operationID: operation,
            eventID: child.id,
            calendarID: calendar.id,
            action,
            sendUpdates: "all",
            scope: "occurrence",
            expectedInstanceVersion: observation.organizerEdit.instanceVersion,
            expectedRevision: child.revision,
            expectedStateVersion: observation.version,
            ...(action === "update"
              ? { patch: { title: "Changed occurrence" } }
              : {}),
          };
          async function pullCancelled(
            change: "cancelled" | "active" | "foreign" = "cancelled",
          ) {
            const parentNative = {
              ...initialNative,
              id: "series",
              recurringEventId: undefined,
              originalStartTime: undefined,
              summary: "Series inherited content",
              recurrence: ["RRULE:FREQ=DAILY;COUNT=4"],
              start: allDay
                ? { date: "2026-10-24" }
                : {
                    dateTime: "2026-10-24T08:00:00Z",
                    timeZone: "Europe/Prague",
                  },
              end: allDay
                ? { date: "2026-10-25" }
                : {
                    dateTime: "2026-10-24T09:00:00Z",
                    timeZone: "Europe/Prague",
                  },
            };
            const cancellation = {
              id: "instance",
              status: "cancelled",
              etag: '\"cancelled-version\"',
              recurringEventId: "series",
              originalStartTime:
                change === "foreign"
                  ? allDay
                    ? { date: "2026-10-26" }
                    : {
                        dateTime: "2026-10-26T09:00:00Z",
                        timeZone: "Europe/Prague",
                      }
                  : initialNative.originalStartTime,
            };
            listing = [
              parentNative,
              change === "active"
                ? { ...initialNative, etag: '\"stale-active\"' }
                : cancellation,
            ];
            const fetched = await fetchGoogleChanges(
              "synthetic-organizer-instance",
              "owner@example.test",
              "before",
              { timeModels: true },
            );
            assert.equal(fetched.nextCursor, "cancellation-observed");
            const found = fetched.changes.find(
              (c) => c.kind === "event" && c.data.externalId === "instance",
            );
            assert.ok(found?.kind === "event");
            const value = found.data;
            assert.equal(value.status, "active");
            assert.equal(value.isCanceled, change !== "active");
            const before = await getEventSnapshot(child.id);
            const beforeMarker = structuredClone(
              (
                await db
                  .select()
                  .from(eventOutbox)
                  .where(eq(eventOutbox.id, operation))
              )[0]!.payload.organizer!.dispatch,
            );
            await upsertExternalEvent(
              "google",
              owner,
              calendar.id,
              "owner@example.test",
              "instance",
              {
                title: value.title!,
                color: "red",
                start: value.start!,
                end: value.end!,
                isAllDay: value.isAllDay!,
                description: value.description ?? null,
                location: value.location ?? null,
                organizer: value.organizer ?? "owner@example.test",
                recurrence: value.recurrence ?? null,
                url: value.url ?? null,
              },
              value.etag ?? null,
              "family-uid",
              undefined,
              {
                timeModel: value.timeModel!,
                externalSeriesID: value.externalSeriesID,
                originalStart: value.originalStart,
                isCanceled: value.isCanceled,
              },
              undefined,
              value.providerState,
            );
            assert.deepEqual(
              await getEventSnapshot(child.id),
              before,
              "Native cancelled projection cannot overwrite exception content, timing or revision",
            );
            const [observed] = await db
              .select()
              .from(eventOutbox)
              .where(eq(eventOutbox.id, operation));
            assert.equal(
              observed!.remoteSnapshot!.deleted,
              change === "cancelled",
            );
            assert.deepEqual(
              observed!.payload.organizer!.dispatch,
              beforeMarker,
            );
          }
          const bumpParent = async () => {
            await db
              .update(events)
              .set({ revision: parent.revision + 1 })
              .where(eq(events.id, parent.id));
          };
          const changeMap = async () => {
            await db
              .update(externalEvents)
              .set({ externalEventID: "other-parent" })
              .where(eq(externalEvents.id, parentMap.id));
          };
          if (scenario === "parent-stale-observation") await bumpParent();
          if (scenario === "parent-before-commit") onRead = bumpParent;
          if (scenario === "parent-map-before-commit") onRead = changeMap;
          if (scenario === "parent-pending" || scenario === "parent-cancelled")
            await db.insert(eventOutbox).values({
              id: randomUUID(),
              actorID: owner,
              mutationID: randomUUID(),
              position: 0,
              eventID: parent.id,
              revision: parent.revision,
              calendarID: calendar.id,
              externalCalendarLinkID: link!.id,
              provider: "google",
              userID: owner,
              accountID: "fixture",
              externalCalendarID: "owner@example.test",
              externalEventID: "series",
              action: "update",
              status: scenario === "parent-pending" ? "pending" : "cancelled",
              payload: { event: parent },
            });
          if (scenario === "native-parent") native.recurringEventId = "wrong";
          if (scenario === "native-original")
            native.originalStartTime = { date: "2026-10-23" };
          if (scenario === "cancelled-child")
            await db
              .update(events)
              .set({ isCanceled: true })
              .where(eq(events.id, child.id));
          if (scenario === "missing-scope") {
            delete request.scope;
            delete request.expectedInstanceVersion;
          }
          if (scenario === "time-patch")
            request.patch.time = {
              kind: "all-day",
              startDate: "2026-10-25",
              endDate: "2026-10-25",
            };
          if (scenario === "master") request.eventID = parent.id;
          if (scenario === "generated")
            request.eventID = `${parent.id}_1792915200000`;
          const post = () =>
            realFetch(`${origin}/api/v1/provider-organizer`, {
              method: "POST",
              headers,
              body: JSON.stringify(request),
            });
          const response = await post();
          const admitted = [
            "mark-parent-revision",
            "mark-parent-mapping",
            "update",
            "delete",
            "delete-pull-before-ack",
            "delete-foreign-before-ack",
            "delete-foreign-parent-lock",
            "delete-active-before-ack",
            "update-lost",
            "delete-lost",
            "parent-before-dispatch",
            "parent-after-dispatch",
            "map-after-dispatch",
            "grant-after-dispatch",
            "lease-after-dispatch",
            "account-before-dispatch",
            "source-before-dispatch",
          ].includes(scenario);
          assert.equal(writes, 0, "Public admission never dispatches");
          if (!admitted) {
            assert.ok(
              response.status >= 400,
              `${scenario}: ${response.status}`,
            );
            assert.equal(
              (
                await db
                  .select()
                  .from(eventOutbox)
                  .where(eq(eventOutbox.eventID, child.id))
              ).length,
              0,
            );
            continue;
          }
          assert.equal(
            response.status,
            202,
            JSON.stringify(await response.clone().json()),
          );
          const [saved] = await db
            .select()
            .from(eventOutbox)
            .where(eq(eventOutbox.id, operation));
          assert.deepEqual(saved!.payload.organizer!.instance, {
            seriesID: parent.id,
            parentRevision: parent.revision,
            parentMappingID: parentMap.id,
            externalSeriesID: "series",
            originalStart,
          });
          assert.deepEqual(
            saved!.payload.organizer!.sourceEvent,
            JSON.parse(JSON.stringify(EventSchema.parse(child))),
          );
          assert.deepEqual(saved!.payload.organizer!.baseline, initialNative);
          assert.equal((await (await post()).json()).replayed, true);
          assert.deepEqual(await getEventSnapshot(parent.id), parent);
          if (scenario.startsWith("mark-parent")) {
            const claimed = await claimEventOutbox(operation);
            assert.ok(claimed);
            await verifyOrganizerDispatchLocks(claimed!, (tx) =>
              scenario === "mark-parent-revision"
                ? tx
                    .update(events)
                    .set({ revision: parent.revision + 1 })
                    .where(eq(events.id, parent.id))
                : tx
                    .update(externalEvents)
                    .set({ externalEventID: "replaced-parent" })
                    .where(eq(externalEvents.id, parentMap.id)),
            );
            assert.equal(writes, 0);
            console.log(
              `Google organizer instance ${allDay ? "date" : "zoned"} ${scenario}: OK`,
            );
            continue;
          }
          if (scenario === "delete-pull-before-ack")
            onWrite = () => pullCancelled();
          if (scenario === "delete-foreign-before-ack")
            onWrite = () => pullCancelled("foreign");
          if (scenario === "delete-foreign-parent-lock")
            onWrite = async () => {
              let pull: Promise<void> | undefined;
              let timeout: ReturnType<typeof setTimeout> | undefined;
              try {
                await db.transaction(async (tx) => {
                  await tx
                    .select({ id: events.id })
                    .from(events)
                    .where(eq(events.id, parent.id))
                    .for("update");
                  pull = pullCancelled("foreign");
                  await Promise.race([
                    pull,
                    new Promise<never>((_, reject) => {
                      timeout = setTimeout(
                        () =>
                          reject(
                            new Error(
                              "Foreign cancellation attempted parent lock after child",
                            ),
                          ),
                        2000,
                      );
                    }),
                  ]);
                });
              } finally {
                clearTimeout(timeout);
                await pull;
              }
            };
          if (scenario === "delete-active-before-ack")
            onWrite = () => pullCancelled("active");
          if (scenario === "parent-before-dispatch") onRead = bumpParent;
          if (scenario === "parent-after-dispatch") onWrite = bumpParent;
          if (scenario === "map-after-dispatch") onWrite = changeMap;
          if (scenario === "grant-after-dispatch")
            onWrite = async () => {
              await db
                .update(calendarMembers)
                .set({ role: "viewer" })
                .where(
                  and(
                    eq(calendarMembers.calendarID, calendar.id),
                    eq(calendarMembers.userID, owner),
                  ),
                );
            };
          if (scenario === "lease-after-dispatch")
            onWrite = async () => {
              await db
                .update(eventOutbox)
                .set({
                  leaseToken: randomUUID(),
                  leaseUntil: new Date(Date.now() + 60000),
                })
                .where(eq(eventOutbox.id, operation));
            };
          if (scenario === "account-before-dispatch")
            onRead = async () => {
              await db
                .update(account)
                .set({ syncStatus: "disabled" })
                .where(eq(account.userId, owner));
            };
          if (scenario === "source-before-dispatch")
            onRead = async () => {
              await db
                .update(externalCalendars)
                .set({ disabled: true })
                .where(eq(externalCalendars.id, link!.id));
            };
          await deliverEventOutbox(operation, () => googleAdapter);
          const [delivered] = await db
            .select()
            .from(eventOutbox)
            .where(eq(eventOutbox.id, operation));
          const shouldComplete = [
            "update",
            "delete",
            "delete-pull-before-ack",
          ].includes(scenario);
          assert.equal(
            delivered!.status === "completed",
            shouldComplete,
            `${scenario}: ${delivered!.status}`,
          );
          assert.equal(writes, scenario.endsWith("before-dispatch") ? 0 : 1);
          if (shouldComplete) {
            const [afterMap] = await db
              .select()
              .from(externalEvents)
              .where(eq(externalEvents.id, mapping.id));
            assert.equal(afterMap!.eventID, child.id);
            assert.equal(afterMap!.externalSeriesID, "series");
            assert.deepEqual(afterMap!.originalStart, originalStart);
            assert.deepEqual(await getEventSnapshot(parent.id), parent);
            if (action === "update") {
              assert.deepEqual(native.attendees, initialNative.attendees);
              assert.deepEqual(
                native.originalStartTime,
                initialNative.originalStartTime,
              );
              assert.deepEqual(native.start, initialNative.start);
            }
          }
          if (scenario === "delete") {
            const marker = structuredClone(
              delivered!.payload.organizer!.dispatch,
            );
            await pullCancelled();
            assert.equal(
              (
                await db
                  .select()
                  .from(eventOutbox)
                  .where(eq(eventOutbox.id, operation))
              )[0]!.status,
              "completed",
            );
            for (const foreign of ["active", "foreign"] as const) {
              await pullCancelled(foreign);
              await db
                .update(eventOutbox)
                .set({ nextAttemptAt: new Date(0) })
                .where(eq(eventOutbox.id, operation));
              await requestEventDeliveryRetry(owner, child.id, operation);
              await deliverEventOutbox(operation, () => googleAdapter);
              assert.notEqual(
                (
                  await db
                    .select()
                    .from(eventOutbox)
                    .where(eq(eventOutbox.id, operation))
                )[0]!.status,
                "completed",
                "Foreign slot and stale active observations cannot confirm cancellation",
              );
              await pullCancelled();
              await db
                .update(eventOutbox)
                .set({ nextAttemptAt: new Date(0) })
                .where(eq(eventOutbox.id, operation));
              await requestEventDeliveryRetry(owner, child.id, operation);
              await deliverEventOutbox(operation, () => googleAdapter);
              assert.equal(
                (
                  await db
                    .select()
                    .from(eventOutbox)
                    .where(eq(eventOutbox.id, operation))
                )[0]!.status,
                "completed",
              );
            }
            assert.deepEqual(
              (
                await db
                  .select()
                  .from(eventOutbox)
                  .where(eq(eventOutbox.id, operation))
              )[0]!.payload.organizer!.dispatch,
              marker,
            );
            await deleteExternalEvent("google", calendar.id, "instance");
            const [tombstoned] = await db
              .select()
              .from(events)
              .where(eq(events.id, child.id));
            assert.ok(tombstoned!.deletedAt);
            assert.equal(tombstoned!.revision, delivered!.revision + 1);
            const [receipt] = await db
              .select()
              .from(eventOutbox)
              .where(eq(eventOutbox.id, operation));
            assert.equal(
              receipt!.payload.organizer!.dispatch!.cancellationTombstone!
                .revision,
              tombstoned!.revision,
            );
            await db
              .update(eventOutbox)
              .set({ status: "unconfirmed", nextAttemptAt: new Date(0) })
              .where(eq(eventOutbox.id, operation));
            await requestEventDeliveryRetry(owner, child.id, operation);
            await deliverEventOutbox(operation, () => googleAdapter);
            const [confirmed] = await db
              .select()
              .from(eventOutbox)
              .where(eq(eventOutbox.id, operation));
            assert.equal(
              confirmed!.status,
              "completed",
              "Exact accepted cancellation remains reconcilable after inbound tombstone",
            );
            assert.equal(writes, 1);
            assert.deepEqual(await getEventSnapshot(parent.id), parent);
          }
          if (lost) {
            await db
              .update(eventOutbox)
              .set({ nextAttemptAt: new Date(0) })
              .where(eq(eventOutbox.id, operation));
            await requestEventDeliveryRetry(owner, child.id, operation);
            await deliverEventOutbox(operation, () => googleAdapter);
            assert.equal(
              writes,
              1,
              "Lost organizer responses never resend guest notifications",
            );
            const [replayed] = await db
              .select()
              .from(eventOutbox)
              .where(eq(eventOutbox.id, operation));
            assert.equal(
              replayed!.status === "completed",
              action === "update",
              "Absent cancellation without accepted receipt stays uncertain",
            );
          }
          console.log(
            `Google organizer instance ${allDay ? "date" : "zoned"} ${scenario}: OK`,
          );
        } finally {
          await db.delete(user).where(eq(user.id, owner));
        }
      }
  } finally {
    config.api.providerOrganizerEditsEnabled = old;
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
