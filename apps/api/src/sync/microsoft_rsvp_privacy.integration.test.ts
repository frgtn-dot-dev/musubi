import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { config } from "@musubi/config";
import {
  account, db, eventOutbox, externalCalendars, externalEvents, getEventSnapshot,
  getOwnProviderEventObservation, importExternalCalendar, reconcileMicrosoftCalendarAccess,
  requestEventDeliveryRetry, upsertExternalEvent, user,
} from "@musubi/db";
import { graphRsvpFixture } from "./adapters/microsoft_rsvp.fixture";
import { microsoftAdapter, toNormalized } from "./adapters/microsoft";
import { deliverEventOutbox } from "./event_delivery";
import { queueProviderRsvp } from "./provider_rsvp";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const enabled = config.api.providerRsvpEditsEnabled;
  try {
    config.api.providerRsvpEditsEnabled = true;
    for (const phase of ["before-dispatch", "after-dispatch", "access-aba"] as const) {
      const actor = `graph-rsvp-privacy-${randomUUID()}`;
      const fixture = await graphRsvpFixture();
      await db.insert(user).values({ id: actor, name: "Fixture", email: `${actor}@example.test`, isExternal: true });
      try {
        await db.insert(account).values({ id: randomUUID(), userId: actor, providerId: "microsoft", accountId: "account", scope: "Calendars.ReadWrite", refreshToken: "fixture", accessToken: "fixture", accessTokenExpiresAt: new Date(Date.now() + 3600000) });
        const calendar = await importExternalCalendar("microsoft", actor, "account", "Fixture", { externalId: "calendar", name: "Fixture", color: "red" });
        const access = (canViewPrivateItems: boolean) => reconcileMicrosoftCalendarAccess(actor, "account", calendar.id, { canEdit: true, canViewPrivateItems });
        await access(true);
        const persist = async () => {
          const [source] = await db.select().from(externalCalendars).where(eq(externalCalendars.calendarID, calendar.id));
          assert.ok(source);
          const value = toNormalized(fixture.state.native);
          return upsertExternalEvent("microsoft", actor, calendar.id, "calendar", "meeting", { title: value.title, description: value.description, location: value.location, start: value.start, end: value.end, isAllDay: value.isAllDay, organizer: value.organizer ?? "", recurrence: null, url: null, color: "red" }, value.etag, value.icalUid, undefined, undefined, undefined, value.providerState, value.reminderTimeEvidence, undefined, { provider: "microsoft", linkID: source.id, revision: source.providerAccessRevision, userID: actor, accountID: "account", externalCalendarID: "calendar" });
        };
        await persist();
        const [mapping] = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id));
        assert.ok(mapping);
        const original = (await getEventSnapshot(mapping.eventID))!;
        const observation = await getOwnProviderEventObservation(actor, original.id);
        assert.ok(observation.version);
        const queued = await queueProviderRsvp(actor, original.id, { provider: "microsoft", operationID: randomUUID(), expectedRevision: original.revision, expectedStateVersion: observation.version, response: "accepted", notificationPolicy: "send-response" });
        const row = async () => (await db.select().from(eventOutbox).where(eq(eventOutbox.id, queued.operationID)))[0]!;
        const intent = (await row()).payload.rsvp!;
        let retired = false;
        fixture.state.hook = async () => {
          if (phase === "after-dispatch" && fixture.state.posts === 0) return;
          fixture.state.hook = undefined;
          await access(false);
          retired = true;
          if (phase === "access-aba") { await access(true); await persist(); }
        };
        const fetch = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
          if (init?.method === "POST") fixture.state.marked = !!(await row()).payload.rsvp?.graphDispatch;
          return fetch(input, init);
        };
        const deliver = () => deliverEventOutbox(queued.operationID, () => microsoftAdapter, { timeoutMs: 5000 });
        await deliver();
        assert.equal(retired, true, "the real access downgrade must run inside the provider read/dispatch window");
        assert.equal(fixture.state.posts, phase === "after-dispatch" ? 1 : 0);
        assert.notEqual((await row()).status, "completed", "a stale RSVP must not acknowledge across content retirement");
        const current = (await getEventSnapshot(original.id))!;
        assert.equal(current.id, original.id);
        assert.ok(current.revision! > original.revision!);
        assert.ok(current.providerReadRetiredRevision);
        if (phase !== "access-aba") {
          assert.equal(current.title, "Busy");
          assert.equal(current.description, null);
          assert.equal((await getOwnProviderEventObservation(actor, original.id)).state, null);
        }
        if (phase === "after-dispatch") {
          const marker = (await row()).payload.rsvp!.graphDispatch;
          assert.ok(marker);
          const attempts = (await row()).attempts;
          await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, queued.operationID));
          await requestEventDeliveryRetry(actor, original.id, queued.operationID);
          await deliver();
          assert.ok((await row()).attempts > attempts, "the explicit recovery must actually be claimed");
          assert.equal(fixture.state.posts, 1, "explicit Check response cannot dispatch again after retirement");
          assert.deepEqual((await row()).payload.rsvp!.graphDispatch, marker);
          assert.equal((await getEventSnapshot(original.id))!.title, "Busy");
        }
        assert.deepEqual((await row()).payload.rsvp!.baseline, intent.baseline);
        assert.deepEqual((await row()).payload.rsvp!.request, intent.request);
        console.log(`Graph RSVP privacy ${phase}: real retirement fences dispatch/ACK and preserves the immutable intent`);
      } finally { await fixture.close(); await db.delete(user).where(eq(user.id, actor)); }
    }
  } finally { config.api.providerRsvpEditsEnabled = enabled; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => process.exit());
