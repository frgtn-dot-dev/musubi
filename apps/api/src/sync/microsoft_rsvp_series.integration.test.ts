import express from "express";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { handlerGetProviderEventState, handlerProviderRsvpEdit } from "../handlers/events";
import { issueMemberToken } from "../federation_tokens";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { config } from "@musubi/config";
import {
  CLIENT_VERSION_HEADER,
  PRODUCT_VERSION,
  ProviderEventStateResponseSchema,
  ProviderRsvpReceiptSchema,
} from "@musubi/types";
import {
  db,
  user,
  account,
  externalEvents,
  externalCalendars,
  eventOutbox,
  events,
  calendarMembers,
  importExternalCalendar,
  upsertExternalEvent,
  getOwnProviderEventObservation,
  getEventSnapshot,
  getEventDeliveryStatus,
  claimEventOutbox,
  markGraphRsvpDispatched,
  replaceMemberToken,
} from "@musubi/db";
import { graphRsvpSeriesFixture } from "./adapters/microsoft_rsvp_series.fixture";
import { microsoftAdapter, toNormalized } from "./adapters/microsoft";
import { queueProviderRsvp, observeMicrosoftRsvp } from "./provider_rsvp";
import { deliverEventOutbox } from "./event_delivery";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const flag = config.api.providerRsvpEditsEnabled;
  const app = express();
  app.use(express.json());
  app.get("/events/:eventId/provider-state", requireAuth, handlerGetProviderEventState);
  app.post("/events/:eventId/provider-rsvp", requireAuth, handlerProviderRsvpEdit);
  app.use(middlewareErrorHandler);
  const api = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => api.once("listening", resolve));
  const address = api.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    for (const scenario of [
      "public",
      "public-answered",
      "accepted",
      "tentative",
      "exception-anchor",
      "stale-preview",
      "parent-drift",
      "exception-drift",
      "legacy-reader",
      "lost",
      "not-observed",
      "decline-absent",
      "before-network-restart",
      "concurrent-admission",
      "occurrence-pending",
      "account-after-read",
      "role-after-read",
      "revision-after-read",
      "slot-after-read",
      "lease-after-read",
      "echo-before-ack",
      "exception-before-ack",
      "worker-flag",
    ] as const) {
      const fixture = await graphRsvpSeriesFixture(),
        actor = "graph-series-rsvp-" + randomUUID();
      await db.insert(user).values({ id: actor, name: "Fixture", email: actor + "@example.test", isExternal: true });
      try {
        config.api.providerRsvpEditsEnabled = true;
        await db
          .insert(account)
          .values({
            id: randomUUID(),
            userId: actor,
            providerId: "microsoft",
            accountId: "account",
            scope: "Calendars.ReadWrite",
            refreshToken: "fixture",
            accessToken: "fixture",
            accessTokenExpiresAt: new Date(Date.now() + 3600000),
          });
        if (scenario === "occurrence-pending" || scenario === "public-answered")
          fixture.state.master.responseStatus.response = "tentativelyAccepted";
        const calendar = await importExternalCalendar("microsoft", actor, "account", "Fixture", {
          externalId: "calendar",
          name: "Fixture",
          color: "red",
        });
        const persist = async (item: any) => {
          const slot = {
            externalSeriesID: "series",
            originalStart: { kind: "instant" as const, value: new Date(item.originalStart).toISOString() },
          };
          const native = toNormalized({ ...item, providerOccurrence: slot });
          return upsertExternalEvent(
            "microsoft",
            actor,
            calendar.id,
            "calendar",
            item.id,
            {
              title: native.title,
              start: native.start,
              end: native.end,
              isAllDay: native.isAllDay,
              description: native.description,
              location: native.location,
              organizer: native.organizer ?? "",
              recurrence: null,
              url: null,
              color: "red",
            },
            native.etag,
            native.icalUid,
            undefined,
            undefined,
            slot,
            native.providerState,
            native.reminderTimeEvidence,
          );
        };
        for (const item of fixture.state.instances) await persist(item);
        const mappings = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id));
        const mapping = mappings.find(
          (item) => item.externalEventID === (scenario === "exception-anchor" ? "slot-29" : "slot-28"),
        )!;
        const snapshot = (await getEventSnapshot(mapping.eventID))!;
        const observe = async (eventID = mapping.eventID) =>
          observeMicrosoftRsvp(
            actor,
            eventID,
            await getOwnProviderEventObservation(actor, eventID, false, true, true),
            true,
          );
        const observed = ProviderEventStateResponseSchema.parse(await observe());
        assert.ok(observed.rsvpEdit?.series);
        assert.equal(
          observed.rsvpEdit.scope,
          scenario === "occurrence-pending" || scenario === "public-answered" ? "occurrence" : "series",
        );
        for (const secret of [
          "graphIdentity",
          "externalSeriesID",
          "originalStart",
          "graphOccurrence",
          "master",
          "baseline",
        ])
          assert.ok(!JSON.stringify(observed).includes('"' + secret + '"'));
        if (scenario === "legacy-reader") {
          assert.equal((await getOwnProviderEventObservation(actor, mapping.eventID, false, true)).rsvpEdit, undefined);
          const old = await observeMicrosoftRsvp(
            actor,
            mapping.eventID,
            await getOwnProviderEventObservation(actor, mapping.eventID, false, true, true),
          );
          assert.equal(old.rsvpEdit, undefined);
          assert.equal(fixture.state.posts, 0);
          continue;
        }
        const credential = issueMemberToken();
        await replaceMemberToken(actor, credential.tokenHash);
        const headers = {
          authorization: `Bearer ${credential.raw}`,
          "content-type": "application/json",
          [CLIENT_VERSION_HEADER]: PRODUCT_VERSION,
        };
        const endpoint = `${origin}/events/${mapping.eventID}`;
        const publicRequest = (suffix: string, body?: unknown) =>
          fixture.originalFetch(endpoint + suffix, {
            headers,
            ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
          });
        if (scenario.startsWith("public")) {
          assert.equal((await fixture.originalFetch(`${endpoint}/provider-state?outlookRsvp=2`)).status, 401);
          for (const version of ["", "?outlookRsvp=1", "?outlookRsvp=2"]) {
            const result = await publicRequest("/provider-state" + version);
            assert.equal(result.status, 200);
            const body = ProviderEventStateResponseSchema.parse(await result.json());
            assert.equal(body.rsvpEdit?.series !== undefined, version === "?outlookRsvp=2");
            assert.equal(
              body.rsvpEdit !== undefined,
              version === "?outlookRsvp=2" || (scenario === "public-answered" && version === "?outlookRsvp=1"),
            );
          }
        }
        const response =
          scenario === "decline-absent"
            ? "declined"
            : scenario === "tentative" || scenario === "exception-anchor"
              ? "tentative"
              : "accepted";
        const request = {
          provider: "microsoft",
          notificationPolicy: "send-response",
          scope: "series",
          operationID: randomUUID(),
          expectedRevision: snapshot.revision,
          expectedStateVersion: observed.version,
          expectedSeriesVersion: observed.rsvpEdit.series.version,
          response,
        };
        if (scenario === "stale-preview") {
          fixture.state.master.subject = "Changed series";
          await assert.rejects(() => queueProviderRsvp(actor, mapping.eventID, request));
          assert.equal(fixture.state.posts, 0);
          continue;
        }
        const sibling = mappings.find((item) => item.externalEventID === "slot-31")!;
        const siblingRequest = async () => {
          const state = await observe(sibling.eventID);
          return {
            ...request,
            operationID: randomUUID(),
            expectedRevision: (await getEventSnapshot(sibling.eventID))!.revision,
            expectedStateVersion: state.version,
            expectedSeriesVersion: state.rsvpEdit?.series?.version,
          };
        };
        if (scenario === "occurrence-pending") {
          const state = await getOwnProviderEventObservation(actor, sibling.eventID, false, true, true);
          await queueProviderRsvp(actor, sibling.eventID, {
            ...request,
            scope: "occurrence",
            expectedSeriesVersion: undefined,
            expectedRevision: (await getEventSnapshot(sibling.eventID))!.revision,
            expectedStateVersion: state.version,
          });
          await assert.rejects(() => queueProviderRsvp(actor, mapping.eventID, request));
          assert.equal(fixture.state.posts, 0);
          continue;
        }
        if (scenario === "concurrent-admission") {
          const second = await siblingRequest();
          const result = await Promise.allSettled([
            queueProviderRsvp(actor, mapping.eventID, request),
            queueProviderRsvp(actor, sibling.eventID, second),
          ]);
          assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
          assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.userID, actor))).length, 1);
          assert.equal(fixture.state.posts, 0);
          continue;
        }
        if (scenario.startsWith("public")) {
          for (const invalid of [
            { ...request, expectedSeriesVersion: undefined },
            { ...request, scope: "occurrence" },
            { ...request, scope: undefined },
            { ...request, expectedSeriesVersion: "bad" },
          ]) {
            const result = await publicRequest("/provider-rsvp", invalid);
            assert.equal(result.status, 400);
          }
          assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.userID, actor))).length, 0);
          assert.equal(fixture.state.posts, 0);
        }
        const queued = scenario.startsWith("public")
          ? await (async () => {
              const result = await publicRequest("/provider-rsvp", request);
              assert.equal(result.status, 202);
              return ProviderRsvpReceiptSchema.parse(await result.json());
            })()
          : await queueProviderRsvp(actor, mapping.eventID, request);
        assert.equal((await queueProviderRsvp(actor, mapping.eventID, request)).operationID, queued.operationID);
        const row = async () => (await db.select().from(eventOutbox).where(eq(eventOutbox.id, queued.operationID)))[0]!;
        const before = await row();
        assert.equal(fixture.state.posts, 0);
        const deliver = () => deliverEventOutbox(queued.operationID, () => microsoftAdapter, { timeoutMs: 15000 });
        if (scenario === "parent-drift") fixture.state.master.body.content = "Concurrent master update";
        if (scenario === "exception-drift") fixture.state.instances[1].body.content = "Concurrent exception update";
        if (scenario === "before-network-restart") {
          const claim = (await claimEventOutbox(queued.operationID))!;
          assert.equal(await markGraphRsvpDispatched(claim), true);
          await db
            .update(eventOutbox)
            .set({ leaseUntil: new Date(0) })
            .where(eq(eventOutbox.id, queued.operationID));
        }
        if (scenario === "worker-flag") config.api.providerRsvpEditsEnabled = false;
        if (["lost", "not-observed", "decline-absent"].includes(scenario)) fixture.state.mode = scenario;
        if (scenario.endsWith("after-read"))
          fixture.state.hook = async () => {
            fixture.state.hook = undefined;
            if (scenario === "account-after-read")
              await db.update(account).set({ syncStatus: "reconnect_required" }).where(eq(account.userId, actor));
            if (scenario === "role-after-read")
              await db
                .update(calendarMembers)
                .set({ role: "viewer" })
                .where(eq(calendarMembers.calendarID, calendar.id));
            if (scenario === "revision-after-read")
              await db
                .update(events)
                .set({ revision: snapshot.revision! + 1 })
                .where(eq(events.id, mapping.eventID));
            if (scenario === "slot-after-read")
              await db
                .update(externalEvents)
                .set({ externalSeriesID: "other" })
                .where(eq(externalEvents.id, mapping.id));
            if (scenario === "lease-after-read")
              await db
                .update(eventOutbox)
                .set({ leaseUntil: new Date(0) })
                .where(eq(eventOutbox.id, queued.operationID));
          };
        if (scenario === "echo-before-ack")
          fixture.state.hook = async () => {
            if (fixture.state.posts) {
              fixture.state.hook = undefined;
              for (const item of fixture.state.instances) await persist(item);
            }
          };
        if (scenario === "exception-before-ack") fixture.state.mode = "exception-change";
        const fetch = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
          if (init?.method === "POST") fixture.state.marked = !!(await row()).payload.rsvp?.graphDispatch;
          return fetch(input, init);
        };
        await deliver();
        let after = await row();
        if (
          ["public", "public-answered", "accepted", "tentative", "exception-anchor", "echo-before-ack"].includes(
            scenario,
          )
        ) {
          assert.equal(after.status, "completed", scenario + ": " + after.errorCode);
          assert.equal((await getEventDeliveryStatus(actor, mapping.eventID)).targets[0]!.graphRsvpPhase, "observed");
          const state = (await db.select().from(externalEvents).where(eq(externalEvents.id, mapping.id)))[0]!
            .providerState!;
          assert.equal(
            state.ownResponse,
            scenario === "exception-anchor"
              ? "accepted"
              : response === "tentative"
                ? "tentativelyAccepted"
                : "accepted",
          );
          for (const item of fixture.state.instances) await persist(item);
          assert.equal(
            (await db.select().from(eventOutbox).where(eq(eventOutbox.userID, actor))).length,
            1,
            "Readback import must not queue a response",
          );
        }
        if (["parent-drift", "exception-drift"].includes(scenario)) {
          assert.equal(after.status, "conflict");
          assert.equal(fixture.state.posts, 0);
        }
        if (scenario.endsWith("after-read") || scenario === "worker-flag" || scenario === "before-network-restart")
          assert.equal(fixture.state.posts, 0);
        if (
          ["lost", "not-observed", "decline-absent", "before-network-restart", "exception-before-ack"].includes(
            scenario,
          )
        ) {
          assert.ok(after.payload.rsvp?.graphDispatch);
          await db
            .update(eventOutbox)
            .set({ nextAttemptAt: new Date(0) })
            .where(eq(eventOutbox.id, queued.operationID));
          await deliver();
          after = await row();
          assert.equal(fixture.state.posts, scenario === "before-network-restart" ? 0 : 1);
          assert.equal(after.status, scenario === "lost" ? "completed" : "unconfirmed");
        }
        assert.deepEqual(after.payload.rsvp!.request, before.payload.rsvp!.request);
        assert.deepEqual(after.payload.rsvp!.baseline, before.payload.rsvp!.baseline);
        console.log("Graph series RSVP DB " + scenario + ": OK");
      } finally {
        await fixture.close();
        await db.delete(user).where(eq(user.id, actor));
      }
    }
  } finally {
    config.api.providerRsvpEditsEnabled = flag;
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
