import assert from "node:assert/strict";
import { config } from "@musubi/config";
import { prepareCaldavRsvp, caldavRsvpResourceHash } from "./caldav_rsvp";
import { createCaldavRsvpFixture, caldavRsvpFixtureData } from "./caldav_rsvp.fixture";
async function main() {
  const fixture = await createCaldavRsvpFixture(), { state, collection, resource } = fixture;
  const savedPrivate = config.security.federationAllowPrivateHosts;
  config.security.federationAllowPrivateHosts = true;
  const savedFlag = config.api.providerRsvpEditsEnabled; config.api.providerRsvpEditsEnabled = true;
  const ref = { id: resource, etag: '"before"', uid: "rsvp-fixture" }, auth = "Basic Zml4dHVyZTpmaXh0dXJl";
  const reset = (mode = "ok") => { Object.assign(state, { data: caldavRsvpFixtureData, etag: '"before"', scheduleTag: '"schedule-before"', mode, puts: 0, reads: 0, requests: [] }); };
  try {
    const { schedulingProperties } = await import("../caldav_scheduling");
    const { readCaldavRsvp, deliverCaldavRsvp } = await import("./caldav_rsvp_delivery");
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
    const isReadOnlyUnconfirmed = (error: any) => error.code === "caldav-rsvp-response-unconfirmed" && error.outcome === "unconfirmed";
    for (const mode of ["ok", "GET-404"]) {
      reset(mode); let callbacks = 0;
      await assert.rejects(() => deliverCaldavRsvp(collection, evidence, auth, undefined, async () => { callbacks++; }, true), isReadOnlyUnconfirmed);
      assert.equal(state.puts, 0); assert.equal(callbacks, 0);
    }
    reset(); state.data = evidence.before.replace("Private notes", "Concurrent private notes"); state.etag = '"changed"';
    await assert.rejects(() => deliverCaldavRsvp(collection, evidence, auth, undefined, undefined, true), isReadOnlyUnconfirmed);
    assert.equal(state.puts, 0);
    for (const mode of ["ok", "metadata"]) {
      reset(); state.data = mode === "metadata" ? evidence.after.replace("DTSTAMP:20260301T090000Z", "DTSTAMP:20260302T090000Z") : evidence.after;
      state.etag = '"after"'; state.scheduleTag = '"schedule-after"';
      const recovered = await deliverCaldavRsvp(collection, evidence, auth, undefined, async () => { assert.fail("Read-only recovery must not dispatch"); }, true);
      assert.equal(recovered.recovered, true); assert.equal(recovered.confirmation.resourceHash, evidence.desiredResourceHash); assert.equal(state.puts, 0);
    }
    // A lost PUT can leave later GETs at the original baseline. The durable
    // dispatch marker makes every subsequent attempt read-only nonetheless.
    reset("lost"); let dispatches = 0;
    await assert.rejects(() => deliverCaldavRsvp(collection, evidence, auth, undefined, async () => { dispatches++; }), (error: any) => error.outcome === "unconfirmed");
    Object.assign(state, { mode: "ok", data: evidence.before, etag: evidence.etag, scheduleTag: evidence.scheduleTag });
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(() => deliverCaldavRsvp(collection, evidence, auth, undefined, async () => { dispatches++; }, true), isReadOnlyUnconfirmed);
    }
    assert.equal(state.puts, 1); assert.equal(dispatches, 1);
    reset(); const markerError = new Error("Dispatch marker did not commit");
    await assert.rejects(() => deliverCaldavRsvp(collection, evidence, auth, undefined, async () => { throw markerError; }), error => error === markerError);
    assert.equal(state.puts, 0);
    reset(); const aborted = new AbortController();
    await assert.rejects(() => deliverCaldavRsvp(collection, evidence, auth, aborted.signal, async () => { aborted.abort(); }), (error: any) => error.name === "AbortError");
    assert.equal(state.puts, 0);
    reset();
    await assert.rejects(() => deliverCaldavRsvp(collection, evidence, auth, undefined, async () => { config.api.providerRsvpEditsEnabled = false; }));
    assert.equal(state.puts, 0); config.api.providerRsvpEditsEnabled = true;
    reset(); let markerCommitted = false;
    state.onPut = async () => { assert.equal(markerCommitted, true); };
    try {
      await deliverCaldavRsvp(collection, evidence, auth, undefined, async () => { await new Promise<void>(resolve => setImmediate(resolve)); markerCommitted = true; });
      assert.equal(state.puts, 1);
    } finally { state.onPut = undefined; }
    reset(); state.data = evidence.after;
    const same = await readCaldavRsvp(collection, ref, auth, "accepted"); assert.equal(same.before, same.after);
    await deliverCaldavRsvp(collection, same, auth); assert.equal(state.puts, 0);
    for (const mode of ["no-auto", "no-outbox", "no-reply", "no-write", "wrong-owner", "two-self", "cross-origin", "wrong-href", "wrong-namespace", "duplicate-response", "failed-propstat", "partial-propstat", "redirect", "weak-etag", "no-schedule-tag"]) {
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
  } finally { config.security.federationAllowPrivateHosts = savedPrivate; config.api.providerRsvpEditsEnabled = savedFlag; await fixture.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
