import assert from "node:assert/strict";
import { createServer } from "node:http";
import { config } from "@musubi/config";
import { googleOrganizerTransport } from "./google_organizer_delivery";
import {
  googleOrganizerBody,
  googleOrganizerNative,
  matchesGoogleOrganizer,
} from "./google_organizer";
import type {
  ProviderOrganizerIntent,
  ProviderOrganizerRequest,
} from "@musubi/types";
const baseline = {
  id: "meeting",
  etag: '"v1"',
  iCalUID: "uid",
  status: "confirmed",
  organizer: { email: "owner@example.test", self: true },
  attendees: [
    {
      email: "guest@example.test",
      optional: false,
      responseStatus: "needsAction",
      comment: "keep",
    },
  ],
  summary: "Meeting",
  description: "Notes",
  location: "Room",
  start: { dateTime: "2026-10-24T08:00:00.000Z", timeZone: "Europe/Prague" },
  end: { dateTime: "2026-10-24T09:00:00.000Z", timeZone: "Europe/Prague" },
  conferenceData: { conferenceId: "keep", signature: "native" },
  reminders: {
    useDefault: false,
    overrides: [{ method: "popup", minutes: 5 }],
  },
  customExtension: { untouched: true },
};
const common = {
  operationID: "00000000-0000-4000-8000-000000000001",
  calendarID: "00000000-0000-4000-8000-000000000002",
  eventID: "00000000-0000-4000-8000-000000000003",
  provider: "google" as const,
  sendUpdates: "all" as const,
};
const old = config.api.providerOrganizerEditsEnabled,
  realFetch = globalThis.fetch;
async function main() {
  try {
    config.api.providerOrganizerEditsEnabled = true;
    for (const action of ["create", "update", "delete"] as const)
      for (const lost of [false, true]) {
        const request: ProviderOrganizerRequest =
          action === "create"
            ? {
                ...common,
                action,
                content: {
                  title: "Meeting",
                  description: "Notes",
                  location: "Room",
                },
                time: {
                  kind: "zoned",
                  timeZone: "Europe/Prague",
                  startLocal: "2026-10-24T10:00:00.000",
                  endLocal: "2026-10-24T11:00:00.000",
                },
                guests: [{ email: "guest@example.test", optional: false }],
                color: "red",
              }
            : action === "update"
              ? {
                  ...common,
                  action,
                  expectedRevision: 1,
                  expectedStateVersion: "a".repeat(64),
                  patch: { title: "Changed" },
                }
              : {
                  ...common,
                  action,
                  expectedRevision: 1,
                  expectedStateVersion: "a".repeat(64),
                };
        const before =
          action === "create"
            ? null
            : googleOrganizerNative(baseline, "owner@example.test");
        const desired = googleOrganizerBody(
          request,
          before,
          "owner@example.test",
        );
        const intent = {
          request,
          baseline: before,
          desired,
          mappingID: null,
          sourceEvent: {},
        } as ProviderOrganizerIntent;
        let current: any = before ? structuredClone(before) : null,
          writes = 0,
          reads = 0;
        const server = createServer(async (req, res) => {
          const url = new URL(req.url!, "http://fixture");
          assert.equal(req.headers.authorization, "Bearer fixture");
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
          if (req.method === "GET") {
            reads++;
            if (!current) {
              res.statusCode = 404;
              res.end();
            } else res.end(JSON.stringify(current));
            return;
          }
          writes++;
          assert.ok(intent.dispatch);
          assert.equal(url.searchParams.get("sendUpdates"), "all");
          assert.equal(url.searchParams.get("conferenceDataVersion"), "1");
          let text = "";
          for await (const chunk of req) text += chunk;
          assert.equal(req.headers["if-match"], before?.etag);
          assert.equal(
            req.method,
            action === "create"
              ? "POST"
              : action === "update"
                ? "PATCH"
                : "DELETE",
          );
          assert.deepEqual(text ? JSON.parse(text) : null, desired);
          current =
            action === "delete"
              ? null
              : action === "create"
                ? {
                    ...baseline,
                    conferenceData: undefined,
                    ...desired,
                    attendees: desired!.attendees,
                    etag: '"v2"',
                  }
                : { ...before, ...desired, etag: '"v2"' };
          if (lost) {
            req.socket.destroy();
            return;
          }
          res.statusCode = action === "delete" ? 204 : 200;
          res.end(current ? JSON.stringify(current) : undefined);
        });
        await new Promise<void>((resolve) =>
          server.listen(0, "127.0.0.1", resolve),
        );
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        globalThis.fetch = (input, init) => {
          const url = new URL(String(input));
          assert.equal(url.origin, "https://www.googleapis.com");
          assert.equal(init?.redirect, "error");
          return realFetch(
            `http://127.0.0.1:${address.port}${url.pathname}${url.search}`,
            init,
          );
        };
        try {
          const session = await googleOrganizerTransport(async () => "fixture")(
            "user",
            "account",
            "owner@example.test",
          );
          const mark = async () => {
            intent.dispatch = {
              kind: "google-organizer-dispatch",
              version: 1,
              startedAt: new Date().toISOString(),
            };
          };
          const accepted = async () => {
            intent.dispatch!.acceptedAt = new Date().toISOString();
          };
          if (lost)
            await assert.rejects(session.deliver(intent, mark, accepted));
          else
            assert.equal(
              (await session.deliver(intent, mark, accepted)).kind,
              action === "delete" ? "deleted" : "observed",
            );
          const replay = await session.deliver(
            intent,
            async () => {
              assert.fail("No second dispatch");
            },
            accepted,
          );
          assert.equal(
            replay.kind,
            action === "delete" ? (lost ? "absent" : "deleted") : "observed",
          );
          assert.equal(writes, 1);
          assert.ok(reads >= 2);
          if (current) {
            current.customExtension = { unrelated: true };
            if (action === "update")
              assert.equal(
                (await session.deliver(intent, mark, accepted)).kind,
                "unconfirmed",
              );
          }
        } finally {
          globalThis.fetch = realFetch;
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      }
    const native = googleOrganizerNative(baseline, "owner@example.test");
    const request: ProviderOrganizerRequest = {
      ...common,
      action: "update",
      expectedRevision: 1,
      expectedStateVersion: "a".repeat(64),
      patch: { title: "Changed" },
    };
    assert.equal(
      matchesGoogleOrganizer(
        { ...baseline, summary: "Changed", etag: '"v2"' },
        request,
        native,
        "owner@example.test",
      ),
      true,
    );
    assert.equal(
      matchesGoogleOrganizer(
        { ...baseline, summary: "Changed", conferenceData: {} },
        request,
        native,
        "owner@example.test",
      ),
      false,
    );
    for (const change of [
      { attendeesOmitted: true },
      { recurrence: ["RRULE:FREQ=DAILY"] },
      { organizer: { email: "other@example.test", self: true } },
      { attendees: [...baseline.attendees, ...baseline.attendees] },
    ])
      assert.throws(() =>
        googleOrganizerNative({ ...baseline, ...change }, "owner@example.test"),
      );
    const timedBaseline = googleOrganizerNative(
      {
        ...baseline,
        start: { ...baseline.start, nativeKey: "keep-start" },
        end: { ...baseline.end, nativeKey: "keep-end" },
      },
      "owner@example.test",
    );
    const timedRequest: ProviderOrganizerRequest = {
      ...request,
      patch: {
        time: {
          kind: "zoned",
          timeZone: "Europe/Prague",
          startLocal: "2026-10-24T10:00:00.000",
          endLocal: "2026-10-25T10:00:00.000",
        },
      },
    };
    const timedBody = googleOrganizerBody(
      timedRequest,
      timedBaseline,
      "owner@example.test",
    )!;
    assert.deepEqual(timedBody.start, {
      dateTime: "2026-10-24T08:00:00.000Z",
      timeZone: "Europe/Prague",
      nativeKey: "keep-start",
    });
    assert.deepEqual(timedBody.end, {
      dateTime: "2026-10-25T09:00:00.000Z",
      timeZone: "Europe/Prague",
      nativeKey: "keep-end",
    });
    assert.equal(
      matchesGoogleOrganizer(
        {
          ...timedBaseline,
          ...timedBody,
          start: {
            ...(timedBody.start as object),
            dateTime: "2026-10-24T10:00:00+02:00",
          },
        },
        timedRequest,
        timedBaseline,
        "owner@example.test",
      ),
      true,
    );
    const dayRequest: ProviderOrganizerRequest = {
      ...request,
      patch: {
        time: {
          kind: "all-day",
          startDate: "2026-10-24",
          endDate: "2026-10-25",
        },
      },
    };
    const dayBody = googleOrganizerBody(
      dayRequest,
      timedBaseline,
      "owner@example.test",
    )!;
    assert.deepEqual(dayBody.start, {
      date: "2026-10-24",
      nativeKey: "keep-start",
    });
    assert.deepEqual(dayBody.end, {
      date: "2026-10-26",
      nativeKey: "keep-end",
    });
    assert.equal(
      matchesGoogleOrganizer(
        { ...timedBaseline, ...dayBody },
        dayRequest,
        timedBaseline,
        "owner@example.test",
      ),
      true,
    );
    assert.throws(() =>
      googleOrganizerNative(
        {
          ...baseline,
          start: { ...baseline.start, dateTime: "2026-10-24T08:00:00.0001Z" },
        },
        "owner@example.test",
      ),
    );
    config.api.providerOrganizerEditsEnabled = false;
    await assert.rejects(
      googleOrganizerTransport(async () => {
        assert.fail("Disabled gate did IO");
      })("user", "account", "owner@example.test"),
    );
    console.log("Google organizer fake HTTP and native preservation: OK");
  } finally {
    globalThis.fetch = realFetch;
    config.api.providerOrganizerEditsEnabled = old;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
