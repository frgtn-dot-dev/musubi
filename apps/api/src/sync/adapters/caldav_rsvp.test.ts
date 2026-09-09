import assert from "node:assert/strict";
import { config } from "@musubi/config";
import { schedulingProperties } from "../caldav_scheduling";
import { prepareCaldavRsvp, caldavRsvpResourceHash } from "./caldav_rsvp";
import { readCaldavRsvp, deliverCaldavRsvp } from "./caldav_rsvp_delivery";
import { createCaldavRsvpFixture, caldavRsvpFixtureData } from "./caldav_rsvp.fixture";
async function main() {
  const fixture = await createCaldavRsvpFixture(), { state, collection, resource } = fixture;
  const savedFlag = config.api.providerRsvpEditsEnabled; config.api.providerRsvpEditsEnabled = true;
  const ref = { id: resource, etag: '"before"', uid: "rsvp-fixture" }, auth = "Basic Zml4dHVyZTpmaXh0dXJl";
  const reset = (mode = "ok") => { Object.assign(state, { data: caldavRsvpFixtureData, etag: '"before"', scheduleTag: '"schedule-before"', mode, puts: 0, reads: 0, requests: [] }); };
  try {
    const evidence = await readCaldavRsvp(collection, ref, auth, "accepted");
    assert.equal(evidence.after, caldavRsvpFixtureData.replace(";PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT", ";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED"));
    for (const mode of ["ok", "metadata", "lost"]) {
      reset(mode); const frozen = JSON.parse(JSON.stringify(evidence)); let callbacks = 0;
      const deliver = () => deliverCaldavRsvp(collection, frozen, auth, undefined, async () => { callbacks++; });
      if (mode === "lost") { await assert.rejects(deliver, (error: any) => error.outcome === "unconfirmed"); state.mode = "ok"; }
      const result = await deliver(); assert.equal(result.notificationDelivery, "unknown"); assert.equal(result.confirmation.resourceHash, evidence.desiredResourceHash);
      await deliver(); assert.equal(state.puts, 1); assert.equal(callbacks, 1);
      assert.deepEqual(frozen, evidence);
    }
    reset(); state.data = evidence.after;
    const same = await readCaldavRsvp(collection, ref, auth, "accepted"); assert.equal(same.before, same.after);
    await deliverCaldavRsvp(collection, same, auth); assert.equal(state.puts, 0);
    for (const mode of ["no-auto", "no-outbox", "no-reply", "no-write", "wrong-owner", "two-self", "cross-origin", "wrong-href", "wrong-namespace", "duplicate-response", "failed-propstat", "redirect", "weak-etag", "no-schedule-tag"]) {
      reset(mode); await assert.rejects(() => readCaldavRsvp(collection, ref, auth, "declined")); assert.equal(state.puts, 0);
    }
    for (const method of ["OPTIONS", "PROPFIND"]) for (const status of [408, 429, 503]) {
      reset(`${method}-${status}`);
      await assert.rejects(() => deliverCaldavRsvp(collection, evidence, auth), (error: any) => error.providerStatus === status && error.retryAfterMs === 17000 && error.outcome === "not-written");
      assert.equal(state.puts, 0);
    }
    for (const mode of ["race", "changed-after"]) { reset(mode); await assert.rejects(() => deliverCaldavRsvp(collection, evidence, auth)); assert.equal(state.puts, 1); }
    reset(); await assert.rejects(() => deliverCaldavRsvp(collection, { ...evidence, after: evidence.after.replace("Private notes", "Injected") }, auth)); assert.equal(state.requests.length, 0);
    for (const change of [
      (s: string) => s.replace("ORGANIZER;CN=Organizer", "ORGANIZER;CN=Organizer;SCHEDULE-AGENT=CLIENT"),
      (s: string) => s.replace("ORGANIZER;CN=Organizer", "ORGANIZER;CN=Organizer;SCHEDULE-AGENT=NONE"),
      (s: string) => s.replace("mailto:organizer@example.test", "mailto:self@example.test"),
      (s: string) => s.replace("CN=Self", "CN=Self;DELEGATED-TO=\"mailto:other@example.test\""),
      (s: string) => s.replace("CN=Self", "CN=Self;PARTSTAT=DECLINED"),
      (s: string) => s.replace("SUMMARY:", "RRULE:FREQ=DAILY;COUNT=2\r\nSUMMARY:"),
      (s: string) => s.replace("SUMMARY:", "RDATE:20260401T090000Z\r\nSUMMARY:"),
    ]) assert.throws(() => prepareCaldavRsvp(change(caldavRsvpFixtureData), { ...ref, scheduleTag: '"tag"' }, evidence.proof, "accepted"));
    for (const stamp of ["20260230T120000Z", "20260901T256000Z", "20260901T120000", "20260901T120000Z;garbage"]) assert.throws(() => caldavRsvpResourceHash(evidence.after.replace(/DTSTAMP:[^\r\n]+/, `DTSTAMP:${stamp}`)));
    assert.notEqual(caldavRsvpResourceHash(evidence.after.replace("other@example.test", "third@example.test")), evidence.desiredResourceHash);
    config.api.providerRsvpEditsEnabled = false; reset(); await assert.rejects(() => deliverCaldavRsvp(collection, evidence, auth)); assert.equal(state.requests.length, 0);
    const xml = '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/collection/</d:href><d:propstat><d:prop><d:owner><d:href>/principal/</d:href></d:owner></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';
    assert.equal(schedulingProperties(xml, collection).size, 1);
    for (const bad of [xml.replace('xmlns:d="DAV:"', 'xmlns:d="DAV:" xmlns:d="evil"'), xml.replace("<d:owner>", "<d:owner bad=\"x\" bad=\"y\">"), '<!DOCTYPE x [<!ENTITY a "b">]>' + xml, xml.replace("</d:prop>", "<d:owner/></d:prop>"), xml.replace("200 OK", "nonsense"), xml.replace("</d:response>", "<d:status>HTTP/1.1 403 Forbidden</d:status></d:response>")]) assert.throws(() => schedulingProperties(bad, collection));
    console.log("CalDAV RSVP: namespace/owner/outbox/self proof, exact PARTSTAT, metadata-only full ACK, lost response/no duplicate send, no-op and adversarial refusals: OK");
  } finally { config.api.providerRsvpEditsEnabled = savedFlag; await fixture.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
