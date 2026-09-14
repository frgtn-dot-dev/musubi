import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "@musubi/config";
import { CaldavOrganizerRequestSchema, type ProviderOrganizerIntent } from "@musubi/types";
import { createCaldavOrganizerFixture } from "./caldav_organizer.fixture";
async function main() {
  config.security.federationAllowPrivateHosts = true;
  config.api.caldavOrganizerEditsEnabled = true;
  config.api.icloudOrganizerCreateEnabled = true;
  config.api.providerRsvpEditsEnabled = false;
  const { caldavOrganizerTransport } = await import("./caldav_organizer_delivery");
  const { caldavOrganizerDesired } = await import("./caldav_organizer");
  const fixture = await createCaldavOrganizerFixture();
  const { state, collection } = fixture;
  state.icloud = true;
  const authorization = "Basic Zml4dHVyZTpmaXh0dXJl";
  let eligible = true, eligibilityReads = 0, revokeAfterFirst = false;
  const transport = caldavOrganizerTransport(async () => authorization, async () => eligible && (!revokeAfterFirst || ++eligibilityReads === 1));
  const request = CaldavOrganizerRequestSchema.parse({ operationID: randomUUID(), eventID: randomUUID(), calendarID: randomUUID(), provider: "caldav", action: "create", notificationPolicy: "server-invite", organizerAddress: "mailto:other@example.test", color: "red", content: { title: "QA meeting", description: null, location: null }, time: { kind: "zoned", timeZone: "UTC", startLocal: "2026-09-16T12:00:00", endLocal: "2026-09-16T12:30:00" }, guests: [{ email: "guest@example.test", optional: false }] });
  try {
    const session = await transport("actor", "account", collection, "create");
    const desired = caldavOrganizerDesired(collection, request, null, session.proof, "20260301T100000Z")!;
    const canonical = (data: string) => data.replace("ORGANIZER:mailto:other@example.test", "ORGANIZER;EMAIL=self@example.test;CN=Owner:/canonical/principal/").replace(";RSVP=TRUE", ";SCHEDULE-STATUS=1.1").replace("PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT", "ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION");
    const intent = (): ProviderOrganizerIntent => ({ request, baseline: null, desired, mappingID: null, sourceEvent: {} as never });
    // Already accepted creates reconcile through GET/PROPFIND only.
    state.data = canonical(desired.data);
    const saved = intent(); saved.dispatch = { version: 1, kind: "caldav-organizer-dispatch", startedAt: "2026-03-01T10:00:00.000Z", acceptedAt: "2026-03-01T10:00:01.000Z" };
    const forbidden = async () => { throw new Error("Unexpected repeat dispatch"); };
    assert.equal((await session.deliver(saved, forbidden, forbidden)).kind, "observed");
    assert.equal(state.puts, 0);
    for (const mutate of [
      (data: string) => data.replace("/canonical/principal/", "/foreign/principal/"),
      (data: string) => data.replace("EMAIL=self@example.test", "EMAIL=foreign@example.test"),
      (data: string) => data.replace(";CN=Owner", ";CN=Owner;CN=Second"),
      (data: string) => data.replace(";CN=Owner", ";CN=Owner;SENT-BY=mailto:foreign@example.test"),
      (data: string) => data.replace("NEEDS-ACTION", "ACCEPTED"),
      (data: string) => data.replace("REQ-PARTICIPANT", "OPT-PARTICIPANT"),
      (data: string) => data.replace("SUMMARY:QA meeting", "SUMMARY:Changed"),
      (data: string) => data.replace("DTSTART:20260916T120000Z", "DTSTART:20260916T130000Z"),
      (data: string) => data.replace("SCHEDULE-STATUS=1.1", "RSVP=FALSE"),
    ]) { state.data = mutate(canonical(desired.data)); await assert.rejects(() => session.deliver(saved, forbidden, forbidden)); assert.equal(state.puts, 0); }
    state.data = canonical(desired.data);
    eligible = false; await assert.rejects(() => session.deliver(saved, forbidden, forbidden)); eligible = true;
    config.api.icloudOrganizerCreateEnabled = false; await assert.rejects(() => session.deliver(saved, forbidden, forbidden)); config.api.icloudOrganizerCreateEnabled = true;
    for (const mode of ["icloud-property-denied", "icloud-property-malformed", "icloud-property-missing", "icloud-identity-changed", "icloud-present-tag", "weak-etag"]) {
      state.mode = mode; await assert.rejects(() => session.deliver(saved, forbidden, forbidden));
    }
    state.mode = "ok";
    revokeAfterFirst = true; eligibilityReads = 0;
    await assert.rejects(() => session.deliver(saved, forbidden, forbidden)); revokeAfterFirst = false;
    state.onRead = async () => { state.etag = `"${state.reads}"`; };
    await assert.rejects(() => session.deliver(saved, forbidden, forbidden)); state.onRead = undefined;
    for (const lost of [false, true]) {
      state.data = null; state.puts = 0; state.mode = lost ? "lost" : "ok";
      state.onPut = async () => { state.data = canonical(state.data!); };
      const fresh = intent();
      const mark = async () => { fresh.dispatch = { version: 1, kind: "caldav-organizer-dispatch", startedAt: "2026-03-01T10:00:00.000Z" }; };
      const accepted = async () => { fresh.dispatch!.acceptedAt = "2026-03-01T10:00:01.000Z"; };
      if (lost) await assert.rejects(() => session.deliver(fresh, mark, accepted));
      else assert.equal((await session.deliver(fresh, mark, accepted)).kind, "observed");
      state.mode = "ok";
      assert.equal((await session.deliver(fresh, forbidden, forbidden)).kind, "observed"); assert.equal(state.puts, 1);
    }
    console.log("iCloud organizer create: exact identity/content ACK, refused drift, flag/eligibility/properties/version fences and no repeat PUT OK");
  } finally { await fixture.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
