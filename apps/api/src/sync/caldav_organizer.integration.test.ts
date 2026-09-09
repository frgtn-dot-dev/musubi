import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, sql } from "drizzle-orm";
import { config } from "@musubi/config";
import {
  CLIENT_VERSION_HEADER,
  PRODUCT_VERSION,
  ProviderOrganizerReceiptSchema,
} from "@musubi/types";
import {
  db,
  user,
  caldavAccounts,
  events,
  eventUsers,
  eventOutbox,
  externalEvents,
  externalCalendars,
  calendarMembers,
  saveCaldavAccount,
  importExternalCalendar,
  replaceExternalEventResource,
  deleteExternalEvent,
  upsertExternalEvent,
  getEventSnapshot,
  getOwnProviderEventObservation,
  getOrganizerTimeEventIDs,
  getEventDeliveryStatus,
  requestEventDeliveryRetry,
  claimEventOutbox,
  replaceMemberToken,
} from "@musubi/db";
import {
  createCaldavOrganizerFixture,
  caldavRsvpDstDurationData,
} from "./adapters/caldav_organizer.fixture";
import { normalizeCaldavResource } from "./adapters/caldav_time";
import { caldavEventState } from "./adapters/provider_event_state";
import ICAL from "ical.js";
import { caldavAdapter, normalizedObjectChanges } from "./adapters/caldav";
import { queueProviderOrganizer } from "./provider_organizer";
import { deliverEventOutbox } from "./event_delivery";
import { encryptSecret } from "./crypto";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import {
  handlerGetProviderEventState,
  handlerProviderOrganizer,
} from "../handlers/events";
import { verifyOrganizerDispatchLocks } from "./provider_organizer_lock.fixture";
async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const flags = {
    time: config.api.eventTimeEditsEnabled,
    organizer: config.api.caldavOrganizerEditsEnabled,
  };
  config.api.eventTimeEditsEnabled = false;
  config.api.caldavOrganizerEditsEnabled = true;
  const app = express();
  app.use(express.json());
  app.get(
    "/events/:eventId/provider-state",
    requireAuth,
    handlerGetProviderEventState,
  );
  app.post("/provider-organizer", requireAuth, handlerProviderOrganizer);
  app.use(middlewareErrorHandler);
  const api = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => api.once("listening", resolve));
  const address = api.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    for (const scenario of [
      "public",
      "retime",
      "retime-no-op",
      "retime-lost",
      "retime-zoned",
      "retime-all-day",
      "retime-reply-after",
      "retime-echo",
      "retime-gap",
      "retime-native-fold",
      "retime-old-native-fold",
      "retime-multi-rdate",
      "retime-offset-seconds",
      "cancel-only",
      "update-only",
      "create",
      "all-day-create",
      "cancel",
      "cancel-stale",
      "cancel-other-creator",
      "lost",
      "metadata",
      "no-op",
      "echo-before-ack",
      "echo-dst-duration",
      "disabled",
      "worker-disabled",
      "viewer",
      "mapping-before",
      "source-before",
      "account-after-read",
      "changed-native",
      "grant-lock",
      "revision-lock",
    ]) {
      const fixture = await createCaldavOrganizerFixture(),
        { state, collection, resource } = fixture;
      const actor = `caldav-organizer-${randomUUID()}`,
        credential = issueMemberToken();
      await db.insert(user).values({
        id: actor,
        name: "Fixture",
        email: `${actor}@example.test`,
        isExternal: true,
      });
      await replaceMemberToken(actor, credential.tokenHash);
      const headers = {
        authorization: `Bearer ${credential.raw}`,
        "content-type": "application/json",
        [CLIENT_VERSION_HEADER]: PRODUCT_VERSION,
      };
      try {
        const account = await saveCaldavAccount(
          actor,
          fixture.origin + "/",
          "fixture",
          encryptSecret("fixture"),
        );
        const calendar = await importExternalCalendar(
          "caldav",
          actor,
          account.id,
          "Fixture",
          {
            externalId: collection,
            name: "Fixture",
            color: "red",
            supportsEvents: true,
          },
        );
        if (
          [
            "echo-dst-duration",
            "retime-zoned",
            "retime-gap",
            "retime-native-fold",
            "retime-old-native-fold",
            "retime-multi-rdate",
            "retime-offset-seconds",
          ].includes(scenario)
        )
          state.data = caldavRsvpDstDurationData
            .replace(
              "mailto:self@example.test\r\n",
              "mailto:guest@example.test\r\n",
            )
            .replace(
              "mailto:organizer@example.test",
              "mailto:self@example.test",
            );
        if (["retime-native-fold", "retime-old-native-fold"].includes(scenario))
          state.data = state.data!.replace(
            "BYMONTH=10;BYDAY=-1SU",
            "BYMONTH=10;BYMONTHDAY=26",
          );
        if (scenario === "retime-old-native-fold")
          state.data = state.data!.replace(
            "20260328T090000",
            "20261026T023000",
          );
        if (scenario === "retime-multi-rdate")
          state.data = state.data!.replace(
            "END:DAYLIGHT",
            "RDATE:20260329T020000,20261201T020000\r\nEND:DAYLIGHT",
          );
        if (scenario === "retime-offset-seconds")
          state.data = state
            .data!.replace("20260328T090000", "20260301T090000")
            .replace("TZOFFSETTO:+0200", "TZOFFSETTO:+020030");
        if (scenario === "retime-all-day")
          state.data = state
            .data!.replace(
              "DTSTART:20260328T090000Z",
              "DTSTART;VALUE=DATE:20260328",
            )
            .replace("DTEND:20260328T100000Z", "DTEND;VALUE=DATE:20260329");
        const persist = async () => {
          const ids = new Set(
            await getOrganizerTimeEventIDs(
              actor,
              account.id,
              collection,
              "caldav",
            ),
          );
          const values = normalizedObjectChanges(
            [{ url: resource, etag: state.etag, data: state.data! }],
            ids,
          ).flatMap((change) => (change.kind === "event" ? [change.data] : []));
          for (const value of values)
            await upsertExternalEvent(
              "caldav",
              actor,
              calendar.id,
              collection,
              resource,
              {
                title: value.title,
                color: "red",
                start: value.start,
                end: value.end,
                isAllDay: value.isAllDay,
                description: value.description ?? null,
                location: value.location ?? null,
                organizer: value.organizer ?? "",
                recurrence: null,
                url: null,
              },
              state.etag,
              "rsvp-fixture",
              undefined,
              value.timeModel
                ? { timeModel: value.timeModel, isCanceled: value.isCanceled }
                : undefined,
              undefined,
              value.providerState,
            );
        };
        const native = normalizeCaldavResource({
          url: resource,
          etag: state.etag,
          data: state.data!,
        })[0]!;
        await replaceExternalEventResource(
          "caldav",
          actor,
          calendar.id,
          collection,
          resource,
          [
            {
              externalId: resource,
              etag: state.etag,
              icalUid: "rsvp-fixture",
              values: {
                title: native.title,
                description: native.description,
                location: native.location,
                url: native.url,
                organizer: native.organizer ?? "",
                recurrence: null,
                start: native.start,
                end: native.end,
                isAllDay: native.isAllDay,
                color: "red",
              },
              time: { timeModel: native.timeModel!, isCanceled: false },
              providerState: caldavEventState(
                new ICAL.Component(
                  ICAL.parse(state.data!),
                ).getFirstSubcomponent("vevent")!,
              ),
            },
          ],
        );
        const [mapping] = await db
          .select()
          .from(externalEvents)
          .where(eq(externalEvents.calendarID, calendar.id));
        const original = (await getEventSnapshot(mapping!.eventID))!;
        if (scenario === "cancel-other-creator") {
          await db.insert(user).values({
            id: "fixture-other-editor",
            name: "Other editor",
            email: "fixture-other-editor@example.test",
            isExternal: true,
          });
          await db
            .update(events)
            .set({ creatorID: "fixture-other-editor" })
            .where(eq(events.id, original.id));
        }
        const observation = await getOwnProviderEventObservation(
          actor,
          original.id,
        );
        const create = scenario === "create" || scenario === "all-day-create";
        const request = {
          operationID: randomUUID(),
          provider: "caldav",
          calendarID: calendar.id,
          eventID: create ? randomUUID() : original.id,
          notificationPolicy: "server-invite",
          ...(create
            ? {
                action: "create",
                color: "red",
                content: {
                  title: "Created",
                  description: null,
                  location: null,
                },
                guests: [{ email: "guest@example.test", optional: false }],
                time:
                  scenario === "all-day-create"
                    ? {
                        kind: "all-day",
                        startDate: "2026-10-24",
                        endDate: "2026-10-24",
                      }
                    : {
                        kind: "zoned",
                        timeZone: "UTC",
                        startLocal: "2026-10-24T09:00:00",
                        endLocal: "2026-10-24T10:00:00",
                      },
              }
            : {
                action:
                  scenario === "cancel" || scenario.startsWith("cancel-")
                    ? "delete"
                    : "update",
                expectedRevision: original.revision,
                expectedStateVersion: observation.version!,
                ...(scenario === "cancel" || scenario.startsWith("cancel-")
                  ? {}
                  : {
                      patch: {
                        ...(scenario.startsWith("retime")
                          ? {
                              time:
                                scenario === "retime-no-op"
                                  ? original.timeModel
                                  : scenario === "retime-all-day"
                                    ? {
                                        kind: "all-day",
                                        startDate: "2026-10-24",
                                        endDate: "2026-10-25",
                                      }
                                    : {
                                        kind: "zoned",
                                        timeZone:
                                          scenario === "retime-zoned" ||
                                          scenario === "retime-gap"
                                            ? "Europe/Prague"
                                            : "UTC",
                                        startLocal:
                                          scenario === "retime-gap"
                                            ? "2026-03-29T02:30:00"
                                            : "2026-03-29T11:00:00",
                                        endLocal: "2026-03-29T12:00:00",
                                      },
                            }
                          : {}),
                        title: ["no-op", "retime-no-op"].includes(scenario)
                          ? original.title
                          : "Updated meeting",
                      },
                    }),
              }),
        };
        if (
          [
            "retime-native-fold",
            "retime-old-native-fold",
            "retime-multi-rdate",
            "retime-offset-seconds",
          ].includes(scenario) &&
          "patch" in request &&
          request.patch
        ) {
          Object.assign(request.patch, {
            time: {
              kind: "zoned",
              timeZone: "Europe/Prague",
              startLocal:
                scenario === "retime-native-fold"
                  ? "2026-10-26T02:30:00"
                  : scenario === "retime-offset-seconds"
                    ? "2026-04-01T09:00:00"
                    : "2026-12-01T09:00:00",
              endLocal:
                scenario === "retime-native-fold"
                  ? "2026-10-26T04:00:00"
                  : scenario === "retime-offset-seconds"
                    ? "2026-04-01T10:00:00"
                    : "2026-12-01T10:00:00",
            },
          });
        }
        if (create) state.data = null;
        if (scenario === "cancel-only") state.mode = "no-write";
        if (scenario === "update-only") state.mode = "no-unbind";
        const journal = () =>
          db.select().from(eventOutbox).where(eq(eventOutbox.userID, actor));
        config.api.caldavOrganizerEditsEnabled = scenario !== "disabled";
        if (scenario === "viewer")
          await db
            .update(calendarMembers)
            .set({ role: "viewer" })
            .where(eq(calendarMembers.calendarID, calendar.id));
        if (["disabled", "viewer"].includes(scenario)) {
          const before = state.requests.length;
          await assert.rejects(() => queueProviderOrganizer(actor, request));
          assert.equal((await journal()).length, 0);
          assert.equal(state.requests.length, before);
          continue;
        }
        if (!create) {
          const shown = await fetch(
            `${origin}/events/${original.id}/provider-state`,
            { headers },
          );
          const body = await shown.text();
          assert.equal(shown.status, 200);
          assert.equal(JSON.parse(body).organizerEdit?.provider, "caldav");
          if (
            [
              "retime-native-fold",
              "retime-old-native-fold",
              "retime-multi-rdate",
              "retime-offset-seconds",
            ].includes(scenario)
          )
            assert.equal(
              JSON.parse(body).organizerEdit.timeEdit,
              scenario === "retime-native-fold" ? true : undefined,
            );

          assert.deepEqual(
            JSON.parse(body).organizerEdit.actions,
            scenario === "cancel-only"
              ? ["delete"]
              : scenario === "update-only"
                ? ["update"]
                : ["update", "delete"],
          );
          if (["cancel-only", "update-only"].includes(scenario)) {
            const wrong: Record<string, unknown> = {
              ...request,
              operationID: randomUUID(),
              action: scenario === "cancel-only" ? "update" : "delete",
              ...(scenario === "cancel-only"
                ? { patch: { title: "Forbidden update" } }
                : { patch: undefined }),
            };
            if (wrong.action === "delete") delete wrong.patch;
            await assert.rejects(() => queueProviderOrganizer(actor, wrong));
            assert.equal((await journal()).length, 0);
            assert.equal(state.puts + state.deletes, 0);
          }
          for (const secret of [
            "BEGIN:VCALENDAR",
            "schedule-before",
            "/principal/",
          ])
            assert.ok(!body.includes(secret));
        }
        if (
          [
            "retime-native-fold",
            "retime-old-native-fold",
            "retime-multi-rdate",
            "retime-offset-seconds",
          ].includes(scenario)
        ) {
          const response = await fetch(`${origin}/provider-organizer`, {
            method: "POST",
            headers,
            body: JSON.stringify(request),
          });
          assert.equal(response.status, 400);
          assert.equal(
            (await response.json()).organizerAdmissionRejected,
            true,
          );
          assert.equal((await journal()).length, 0);
          assert.equal(state.puts + state.deletes, 0);
          assert.deepEqual(await getEventSnapshot(original.id), original);
          continue;
        }
        if (scenario === "retime-gap") {
          const response = await fetch(`${origin}/provider-organizer`, {
            method: "POST",
            headers,
            body: JSON.stringify(request),
          });
          assert.equal(response.status, 400);
          assert.equal(
            (await response.json()).organizerAdmissionRejected,
            true,
          );
          assert.equal((await journal()).length, 0);
          assert.equal(state.puts, 0);
          assert.deepEqual(await getEventSnapshot(original.id), original);
          const corrected = {
            ...request,
            operationID: randomUUID(),
            patch: {
              time: {
                kind: "zoned",
                timeZone: "Europe/Prague",
                startLocal: "2026-03-29T03:30:00",
                endLocal: "2026-03-29T04:00:00",
              },
            },
          };
          const saved = await queueProviderOrganizer(actor, corrected);
          assert.equal(
            (await deliverEventOutbox(saved.operationID, () => caldavAdapter))
              ?.status,
            "completed",
          );
          assert.equal(
            (await getEventSnapshot(original.id))!.start.toISOString(),
            "2026-03-29T01:30:00.000Z",
          );
          assert.equal(state.puts, 1);
          continue;
        }
        const response = await fetch(`${origin}/provider-organizer`, {
          method: "POST",
          headers,
          body: JSON.stringify(request),
        });
        const body = await response.text();
        assert.equal(response.status, 202, body);
        const receipt = ProviderOrganizerReceiptSchema.parse(JSON.parse(body));
        assert.equal(receipt.notificationDelivery, "unknown");
        assert.equal(state.puts, 0);
        assert.equal(state.deletes, 0);
        const row = (await journal())[0]!;
        assert.equal(row.payload.organizer!.request.provider, "caldav");
        assert.equal(
          (await queueProviderOrganizer(actor, request)).replayed,
          true,
        );
        await assert.rejects(() =>
          queueProviderOrganizer(actor, {
            ...request,
            notificationPolicy: "none",
          }),
        );
        assert.equal(
          (
            await db
              .select()
              .from(eventUsers)
              .where(eq(eventUsers.eventID, request.eventID))
          ).length,
          create ? 1 : 0,
        );
        if (scenario === "worker-disabled")
          config.api.caldavOrganizerEditsEnabled = false;
        if (scenario === "mapping-before")
          await db
            .update(externalEvents)
            .set({ etag: '"changed"' })
            .where(eq(externalEvents.id, mapping!.id));
        if (scenario === "source-before")
          await db
            .update(externalCalendars)
            .set({ disabled: true })
            .where(eq(externalCalendars.calendarID, calendar.id));
        if (scenario === "account-after-read")
          state.onRead = async () => {
            await db
              .delete(caldavAccounts)
              .where(eq(caldavAccounts.id, account.id));
          };
        if (scenario === "changed-native") {
          state.data = state.data!.replace("Private notes", "Concurrent notes");
          state.etag = '"changed"';
        }
        if (["grant-lock", "revision-lock"].includes(scenario)) {
          const claimed = (await claimEventOutbox(row.id))!;
          await verifyOrganizerDispatchLocks(claimed, (tx) =>
            scenario === "grant-lock"
              ? tx
                  .update(calendarMembers)
                  .set({ role: "viewer" })
                  .where(eq(calendarMembers.calendarID, calendar.id))
              : tx
                  .update(events)
                  .set({ revision: sql`${events.revision} + 1` })
                  .where(eq(events.id, original.id)),
          );
          assert.equal(state.puts, 0);
          continue;
        }
        if (["lost", "metadata", "retime-lost"].includes(scenario))
          state.mode = scenario === "retime-lost" ? "lost" : scenario;
        if (
          ["echo-before-ack", "echo-dst-duration", "retime-echo"].includes(
            scenario,
          )
        )
          state.onPut = persist;
        if (scenario === "retime-reply-after")
          state.onPut = async () => {
            state.data = state.data!.replace(
              "CN=Other;PARTSTAT=NEEDS-ACTION",
              "CN=Other;PARTSTAT=ACCEPTED",
            );
          };
        let delivered = await deliverEventOutbox(row.id, () => caldavAdapter);
        if (
          scenario === "lost" ||
          scenario === "retime-lost" ||
          scenario === "retime-reply-after"
        ) {
          assert.equal(delivered?.status, "unconfirmed");
          state.mode = "ok";
          assert.ok((await journal())[0]!.nextAttemptAt);
          await requestEventDeliveryRetry(actor, request.eventID, row.id);
          await db
            .update(eventOutbox)
            .set({ nextAttemptAt: new Date(0) })
            .where(eq(eventOutbox.id, row.id));
          delivered = await deliverEventOutbox(row.id, () => caldavAdapter);
        }
        if (scenario === "retime-reply-after") {
          assert.equal(delivered?.status, "unconfirmed");
          assert.equal(state.puts, 1);
          continue;
        }
        if (
          [
            "worker-disabled",
            "mapping-before",
            "source-before",
            "account-after-read",
            "changed-native",
          ].includes(scenario)
        ) {
          assert.notEqual(delivered?.status, "completed");
          assert.equal(state.puts, 0);
          continue;
        }
        assert.equal(
          delivered?.status,
          ["no-op", "retime-no-op"].includes(scenario)
            ? "not-needed"
            : "completed",
        );
        assert.equal(
          state.puts,
          scenario === "cancel" ||
            scenario.startsWith("cancel-") ||
            ["no-op", "retime-no-op"].includes(scenario)
            ? 0
            : 1,
        );
        assert.equal(
          state.deletes,
          scenario === "cancel" || scenario.startsWith("cancel-") ? 1 : 0,
        );
        assert.equal(
          (await queueProviderOrganizer(actor, request)).operationID,
          row.id,
        );
        if (scenario.startsWith("retime") && scenario !== "retime-no-op") {
          const current = await getEventSnapshot(original.id);
          assert.equal(
            current!.start.toISOString(),
            scenario === "retime-all-day"
              ? "2026-10-24T00:00:00.000Z"
              : scenario === "retime-zoned"
                ? "2026-03-29T09:00:00.000Z"
                : "2026-03-29T11:00:00.000Z",
          );
          assert.equal(row.payload.organizer!.desired!.rescheduled, true);
          assert.ok(state.data!.includes("SEQUENCE:3"));
        }
        if (scenario.startsWith("cancel-")) {
          await deleteExternalEvent("caldav", calendar.id, resource);
          const [removed] = await db
            .select()
            .from(events)
            .where(eq(events.id, original.id));
          assert.ok(removed!.deletedAt);
          assert.equal(removed!.revision, row.revision + 1);
          state.data = row.payload.organizer!.baseline!.data as string;
          state.etag = row.expectedEtag!;
          await persist();
          assert.equal(
            (await getEventDeliveryStatus(actor, original.id)).targets[0]!
              .status,
            "conflict",
          );
          const marker = (await journal())[0]!.payload.organizer!.dispatch;
          state.data = null;
          await requestEventDeliveryRetry(actor, original.id, row.id);
          await db
            .update(eventOutbox)
            .set({ nextAttemptAt: new Date(0) })
            .where(eq(eventOutbox.id, row.id));
          assert.equal(
            (await deliverEventOutbox(row.id, () => caldavAdapter))?.status,
            "completed",
          );
          assert.deepEqual(
            (await journal())[0]!.payload.organizer!.dispatch,
            marker,
          );
          assert.equal(state.deletes, 1);
        }

        const delivery = JSON.stringify(
          await getEventDeliveryStatus(actor, request.eventID),
        );
        for (const secret of [
          "BEGIN:VCALENDAR",
          "/principal/",
          "schedule-before",
        ])
          assert.ok(!delivery.includes(secret));
        if (scenario === "echo-dst-duration") {
          const current = await getEventSnapshot(original.id);
          assert.equal(current!.end.toISOString(), original.end.toISOString());
          assert.deepEqual(current!.timeModel, original.timeModel);
        }
        console.log(`CalDAV organizer DB ${scenario}: OK`);
      } finally {
        config.api.caldavOrganizerEditsEnabled = true;
        if (scenario === "cancel-other-creator") {
          await db
            .delete(events)
            .where(eq(events.creatorID, "fixture-other-editor"));
          await db.delete(user).where(eq(user.id, "fixture-other-editor"));
        }
        await db.delete(user).where(eq(user.id, actor));
        await fixture.close();
      }
    }
  } finally {
    config.api.caldavOrganizerEditsEnabled = flags.organizer;
    config.api.eventTimeEditsEnabled = flags.time;
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
