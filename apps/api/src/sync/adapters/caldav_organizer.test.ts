import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "@musubi/config";
import {
  CaldavOrganizerRequestSchema,
  type ProviderOrganizerIntent,
} from "@musubi/types";
import { createCaldavOrganizerFixture } from "./caldav_organizer.fixture";
async function main() {
  const oldPrivate = config.security.federationAllowPrivateHosts,
    oldFlag = config.api.caldavOrganizerEditsEnabled;
  config.security.federationAllowPrivateHosts = true;
  config.api.caldavOrganizerEditsEnabled = true;
  // Construct guarded transports only after installing this fixture's loopback policy.
  const { caldavOrganizerTransport } =
    await import("./caldav_organizer_delivery");
  const {
    caldavOrganizerNative,
    caldavOrganizerDesired,
    matchesCaldavOrganizer,
  } = await import("./caldav_organizer");
  const fixture = await createCaldavOrganizerFixture(),
    { state, collection, resource } = fixture;
  const original = state.data!;
  let authorization = "Basic Zml4dHVyZTpmaXh0dXJl";
  const transport = caldavOrganizerTransport(async () => authorization);
  const ids = {
    operationID: randomUUID(),
    calendarID: randomUUID(),
    eventID: randomUUID(),
    provider: "caldav",
    notificationPolicy: "server-invite",
  };
  const request = CaldavOrganizerRequestSchema.parse({
    ...ids,
    action: "update",
    expectedRevision: 1,
    expectedStateVersion: "a".repeat(64),
    patch: { title: "Updated meeting" },
  });
  const reset = (mode = "ok") =>
    Object.assign(state, {
      data: original,
      etag: '"before"',
      scheduleTag: '"schedule-before"',
      mode,
      puts: 0,
      deletes: 0,
      reads: 0,
      requests: [],
      onRead: undefined,
    });
  try {
    const session = await transport(
      "actor",
      "account",
      collection,
      "update",
      resource,
    );
    const baseline = await session.read(resource);
    assert.ok(baseline);
    const desired = caldavOrganizerDesired(
      collection,
      request,
      baseline,
      session.proof,
      "20260301T100000Z",
    );
    assert.ok(desired);
    assert.equal(
      desired.data,
      original.replace("SUMMARY:Private meeting", "SUMMARY:Updated meeting"),
    );
    const saved = {
      request,
      baseline,
      desired,
      mappingID: randomUUID(),
      sourceEvent: {
        id: ids.eventID,
        creatorID: "fixture",
        organizer: "fixture",
        title: "Private meeting",
        color: "red",
        start: new Date("2026-03-28T09:00:00Z"),
        end: new Date("2026-03-28T10:00:00Z"),
        calendars: [ids.calendarID],
        isCanceled: false,
        isAllDay: false,
        hasAttendees: false,
      },
    } satisfies ProviderOrganizerIntent;
    for (const mode of ["ok", "metadata", "lost"]) {
      reset(mode);
      const intent: ProviderOrganizerIntent = structuredClone(saved);
      let marks = 0;
      const mark = async () => {
        marks++;
        intent.dispatch = {
          kind: "caldav-organizer-dispatch",
          version: 1,
          startedAt: new Date().toISOString(),
        };
      };
      const accepted = async () => {
        intent.dispatch!.acceptedAt = new Date().toISOString();
      };
      const deliver = async () =>
        (
          await transport("actor", "account", collection, "update", resource)
        ).deliver(intent, mark, accepted);
      if (mode === "lost") {
        await assert.rejects(deliver);
        state.mode = "ok";
      }
      assert.equal((await deliver()).kind, "observed");
      await deliver();
      assert.equal(state.puts, 1);
      assert.equal(marks, 1);
    }
    reset();
    state.data = desired.data;
    assert.equal(
      (
        await session.deliver(
          saved,
          async () => assert.fail("no-op marker"),
          async () => {},
        )
      ).kind,
      "observed",
    );
    assert.equal(state.puts, 0);
    for (const mode of [
      "no-auto",
      "no-outbox",
      "no-invite",
      "no-write",
      "wrong-owner",
      "cross-origin",
      "wrong-href",
      "wrong-namespace",
      "duplicate-response",
      "failed-propstat",
      "redirect",
      "weak-etag",
      "no-schedule-tag",
    ]) {
      reset(mode);
      await assert.rejects(async () =>
        (
          await transport("actor", "account", collection, "update", resource)
        ).deliver(
          saved,
          async () => {},
          async () => {},
        ),
      );
      assert.equal(state.puts, 0);
    }
    for (const method of ["OPTIONS", "PROPFIND"])
      for (const code of [408, 429, 503]) {
        reset(`${method}-${code}`);
        await assert.rejects(
          () => transport("actor", "account", collection, "update", resource),
          (error: any) =>
            error.providerStatus === code && error.retryAfterMs === 17000,
        );
      }
    reset();
    state.onRead = async () => {
      authorization = "Basic Y2hhbmdlZA==";
    };
    await assert.rejects(() =>
      session.deliver(
        saved,
        async () => assert.fail("changed authorization"),
        async () => {},
      ),
    );
    assert.equal(state.puts, 0);
    authorization = "Basic Zml4dHVyZTpmaXh0dXJl";
    reset();
    const changed = {
      ...baseline,
      data: desired.data.replace("PARTSTAT=ACCEPTED", "PARTSTAT=DECLINED"),
    };
    assert.equal(matchesCaldavOrganizer(changed, desired, baseline), false);
    const create = CaldavOrganizerRequestSchema.parse({
      ...ids,
      action: "create",
      content: { title: "New meeting", description: null, location: null },
      time: {
        kind: "zoned",
        timeZone: "UTC",
        startLocal: "2026-03-28T09:00:00",
        endLocal: "2026-03-28T10:00:00",
      },
      guests: [{ email: "guest@example.test", optional: false }],
      color: "red",
    });
    reset();
    state.data = null;
    const creation = await transport("actor", "account", collection, "create");
    const created = caldavOrganizerDesired(
      collection,
      create,
      null,
      creation.proof,
      "20260301T100000Z",
    );
    const createIntent = {
      ...saved,
      request: create,
      baseline: null,
      desired: created,
    };
    assert.equal(
      (
        await creation.deliver(
          createIntent,
          async () => {},
          async () => {},
        )
      ).kind,
      "observed",
    );
    assert.equal(state.puts, 1);
    reset();
    const deletion = CaldavOrganizerRequestSchema.parse({
      ...ids,
      action: "delete",
      expectedRevision: 1,
      expectedStateVersion: "a".repeat(64),
    });
    const deleteIntent: ProviderOrganizerIntent = {
      ...saved,
      request: deletion,
      desired: null,
    };
    const deleteSession = await transport(
      "actor",
      "account",
      collection,
      "delete",
      resource,
    );
    assert.equal(
      (
        await deleteSession.deliver(
          deleteIntent,
          async () => {},
          async () => {},
        )
      ).kind,
      "deleted",
    );
    assert.equal(state.deletes, 1);
    reset();
    state.data = null;
    deleteIntent.dispatch = {
      kind: "caldav-organizer-dispatch",
      version: 1,
      startedAt: new Date().toISOString(),
    };
    assert.equal(
      (
        await deleteSession.deliver(
          deleteIntent,
          async () => assert.fail("no resend"),
          async () => {},
        )
      ).kind,
      "absent",
    );
    assert.equal(state.deletes, 0);
    reset();
    assert.equal(
      matchesCaldavOrganizer(
        {
          ...baseline,
          data: desired.data.replace("SEQUENCE:2", "SEQUENCE;X-KEEP=changed:3"),
        },
        {
          ...desired,
          data: desired.data.replace(
            "SEQUENCE:2",
            "SEQUENCE;X-KEEP=original:2",
          ),
        },
        baseline,
      ),
      false,
    );
    for (const invalid of [
      original.replace("SEQUENCE:2", "SEQUENCE;X-KEEP=original:2"),
      original.replace("DTSTAMP:20260301T090000Z", "DTSTAMP:20260230T090000Z"),
      original.replace("SUMMARY:", "RRULE:FREQ=DAILY;COUNT=2\r\nSUMMARY:"),
      original.replace("SUMMARY:", "EXDATE:20260328T090000Z\r\nSUMMARY:"),
      original.replace(
        "ORGANIZER;CN=Organizer:",
        "ORGANIZER;CN=Organizer;SCHEDULE-AGENT=CLIENT:",
      ),
      original.replace("CN=Other;", "CN=Other;SCHEDULE-FORCE-SEND=REQUEST;"),
      original.replace("CN=Other;", "CN=Other;CUTYPE=RESOURCE;"),
      original.replace("DTEND:20260328T100000Z", "DTEND:20260328T090000Z"),
    ])
      assert.throws(() =>
        caldavOrganizerNative({ ...baseline, data: invalid }),
      );
    assert.equal(
      matchesCaldavOrganizer(
        { ...baseline, data: desired.data.replace("SEQUENCE:2", "SEQUENCE:1") },
        desired,
        baseline,
      ),
      false,
    );
    assert.equal(
      matchesCaldavOrganizer(
        { ...baseline, data: desired.data.replace("X-KEEP=yes", "X-KEEP=no") },
        desired,
        baseline,
      ),
      false,
    );
    assert.equal(
      CaldavOrganizerRequestSchema.safeParse({
        ...create,
        time: {
          kind: "zoned",
          timeZone: "Europe/Prague",
          startLocal: "2026-03-28T09:00:00",
          endLocal: "2026-03-28T10:00:00",
        },
      }).success,
      false,
    );
    config.api.caldavOrganizerEditsEnabled = false;
    await assert.rejects(() =>
      transport("actor", "account", collection, "create"),
    );
    assert.equal(state.requests.length, 0);
    console.log(
      "CalDAV organizer: preserving content, create/delete CAS, full ACK, permanent lost-response fence, namespace/privilege and credential refusals: OK",
    );
  } finally {
    await fixture.close();
    config.security.federationAllowPrivateHosts = oldPrivate;
    config.api.caldavOrganizerEditsEnabled = oldFlag;
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
