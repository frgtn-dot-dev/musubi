import assert from "node:assert/strict";
import { config } from "@musubi/config";
import { graphRsvpNative, graphRsvpFixture } from "./microsoft_rsvp.fixture";
import { graphRsvpTime, microsoftRsvpEvidence, matchesMicrosoftRsvp } from "./microsoft_rsvp";
import { graphRsvpSession } from "./microsoft_rsvp_delivery";
async function main() {
  const previous = config.api.providerRsvpEditsEnabled;
  config.api.providerRsvpEditsEnabled = true;
  try {
    for (const response of ["accepted", "tentative", "declined"] as const) {
      const fixture = await graphRsvpFixture();
      try {
        const session = await graphRsvpSession("fixture", "account", "calendar");
        const saved = (await session.read("meeting", response))!;
        const baseline = structuredClone(saved); let accepted = 0;
        const result = await session.write(saved, false, async () => { fixture.state.marked = true; }, async () => { accepted++; });
        assert.equal(result.kind, "observed"); assert.equal(accepted, 1); assert.equal(fixture.state.posts, 1); assert.deepEqual(saved, baseline);
        assert.equal((await session.write(saved, true, async () => { throw Error("must not resend"); }, async () => {})).kind, "observed"); assert.equal(fixture.state.posts, 1);
      } finally { await fixture.close(); }
    }
    for (const mode of ["lost", "not-observed", "decline-absent", "changed"] as const) {
      const fixture = await graphRsvpFixture(); fixture.state.mode = mode;
      try {
        const session = await graphRsvpSession("fixture", "account", "calendar");
        const saved = (await session.read("meeting", "declined"))!;
        const run = () => session.write(saved, false, async () => { fixture.state.marked = true; }, async () => {});
        if (mode === "lost") await assert.rejects(run); else assert.equal((await run()).kind, mode === "decline-absent" ? "absent" : "unconfirmed");
        const recovered = await session.write(saved, true, async () => { throw Error("must not resend"); }, async () => {});
        assert.equal(recovered.kind, mode === "lost" ? "observed" : mode === "decline-absent" ? "absent" : "unconfirmed"); assert.equal(fixture.state.posts, 1);
      } finally { await fixture.close(); }
    }
    const fixture = await graphRsvpFixture();
    try {
      const originalSession = await graphRsvpSession("fixture", "account", "calendar");
      const bound = (await originalSession.read("meeting", "accepted"))!;
      assert.equal(bound.graphIdentity?.graphUserID, "graph-object-id");
      const legacy = structuredClone(bound); delete legacy.graphIdentity;
      await assert.rejects(originalSession.write(legacy, false, async () => { throw Error("must not infer legacy identity"); }, async () => {}));
      await assert.rejects(originalSession.write(legacy, true, async () => {}, async () => {}));
      fixture.state.mode = "swapped";
      const swapped = await graphRsvpSession("fixture", "account", "calendar");
      await assert.rejects(swapped.write(bound, false, async () => { throw Error("must not dispatch"); }, async () => {}));
      await assert.rejects(swapped.write(bound, true, async () => {}, async () => {}));
      fixture.state.reads = 0;
      config.api.providerRsvpEditsEnabled = false;
      await assert.rejects(() => graphRsvpSession("fixture", "account", "calendar")); assert.equal(fixture.state.reads, 0);
      config.api.providerRsvpEditsEnabled = true;
      for (const mode of ["denied", "foreign"]) { fixture.state.mode = mode; await assert.rejects(() => graphRsvpSession("fixture", "account", "calendar")); }
      assert.equal(fixture.state.posts, 0);
    } finally { await fixture.close(); }
    for (const mutate of [(n: any) => n.attendees.push(n.attendees[0]), (n: any) => n.isOrganizer = true, (n: any) => n.type = "occurrence", (n: any) => n.attendees[0].type = "resource", (n: any) => n.organizer.emailAddress.address = "self@example.test"]) { const native = graphRsvpNative(); mutate(native); assert.throws(() => microsoftRsvpEvidence(native, "self@example.test", "accepted")); }
    for (const value of ["2026-02-30T08:00:00", "2026-03-28T08:00:00.0000001", "2026-03-28T08:00:00Z"]) { const invalid = graphRsvpNative(); invalid.start.dateTime = value; assert.throws(() => graphRsvpTime(invalid)); }
    const allDay = graphRsvpNative(); allDay.isAllDay = true; allDay.start.dateTime = "2026-03-28T00:00:00"; allDay.end.dateTime = "2026-03-30T00:00:00"; assert.equal(graphRsvpTime(allDay).end.toISOString(), "2026-03-29T00:00:00.000Z");
    for (const response of ["accepted", "tentative", "declined"] as const) {
      const baseline = graphRsvpNative(); baseline.showAs = "tentative"; baseline.attendees[0]!.status.response = "none";
      const proof = microsoftRsvpEvidence(baseline, "self@example.test", response);
      const actual = structuredClone(baseline); actual.responseStatus.response = response === "tentative" ? "tentativelyAccepted" : response;
      assert.equal(matchesMicrosoftRsvp(proof, actual), true, "Self attendee may retain its baseline status");
      actual.showAs = "busy";
      assert.equal(matchesMicrosoftRsvp(proof, actual), response === "accepted", "Only evidenced Accept availability transition");
      actual.showAs = "free"; assert.equal(matchesMicrosoftRsvp(proof, actual), false);
      actual.showAs = "tentative"; actual.attendees[0]!.status.response = "declined";
      assert.equal(matchesMicrosoftRsvp(proof, actual), response === "declined", "Arbitrary self response is rejected");
      actual.attendees[0]!.status.response = "none"; actual.attendees[1]!.status.response = "declined";
      assert.equal(matchesMicrosoftRsvp(proof, actual), false, "Foreign attendee must remain unchanged");
    }
    for (const response of ["accepted", "tentative", "declined"] as const) {
      const baseline = graphRsvpNative(); baseline.attendees[0]!.status.response = "none";
      const proof = microsoftRsvpEvidence(baseline, "self@example.test", response);
      const actual = structuredClone(baseline); actual.responseStatus.response = response === "tentative" ? "tentativelyAccepted" : response;
      actual.showAs = "tentative";
      assert.equal(matchesMicrosoftRsvp(proof, actual), response === "tentative", "Only Tentative permits busy to tentative");
      actual.showAs = "free"; assert.equal(matchesMicrosoftRsvp(proof, actual), false);
    }
    for (const original of [undefined, null, {}, 7]) {
      const baseline: any = graphRsvpNative(); baseline.showAs = original;
      const proof = microsoftRsvpEvidence(baseline, "self@example.test", "accepted");
      const actual = structuredClone(baseline); actual.responseStatus.response = "accepted";
      actual.showAs = original === null ? undefined : null;
      assert.equal(matchesMicrosoftRsvp(proof, actual), false, "Raw availability absence/null/malformed changes are not hidden");
    }
    const native = graphRsvpNative(), evidence = microsoftRsvpEvidence(native, "self@example.test", "accepted");
    native.responseStatus.response = "accepted"; native.attendees[0]!.status.response = "accepted";
    assert.equal(matchesMicrosoftRsvp(evidence, native), true); native.customPreserved.value = "different"; assert.equal(matchesMicrosoftRsvp(evidence, native), false);
    // A recurring response is bound to one imported slot, never its master.
    for (const response of ["accepted", "tentative", "declined"] as const) {
      const fixture = await graphRsvpFixture(true);
      const binding = { externalSeriesID: "series", originalStart: { kind: "instant" as const, value: fixture.state.native.originalStart! } };
      try {
        // A moved exception keeps its original slot identity; current time is
        // independent of originalStart and must remain unchanged by the action.
        if (response === "accepted") { fixture.state.native.type = "exception"; fixture.state.native.start.dateTime = "2026-03-29T15:00:00"; fixture.state.native.end.dateTime = "2026-03-29T16:00:00"; }
        const session = await graphRsvpSession("fixture", "account", "calendar");
        await assert.rejects(() => session.read("meeting", response), "Unscoped requests cannot target a recurring meeting");
        const saved = (await session.read("meeting", response, binding))!;
        const master = structuredClone(fixture.state.master);
        const result = await session.write(saved, false, async () => { fixture.state.marked = true; }, async () => {});
        assert.equal(result.kind, "observed"); assert.equal(fixture.state.posts, 1);
        assert.equal((await session.write(saved, true, async () => { throw Error("must not resend"); }, async () => {})).kind, "observed");
        assert.deepEqual({ ...fixture.state.master, "@odata.etag": master["@odata.etag"], changeKey: master.changeKey }, master);
        const actual = structuredClone(fixture.state.native);
        for (const mutate of [
          (n: typeof actual) => { n.originalStart = "2026-03-29T08:00:00.000Z"; },
          (n: typeof actual) => { n.seriesMasterId = "another-series"; },
          (n: typeof actual) => { n.iCalUId = "another-uid"; },
          (n: typeof actual) => { n.start.dateTime = "2026-03-28T10:00:00"; },
          (n: typeof actual) => { n.attendees[1]!.status.response = "declined"; },
        ]) { const changed = structuredClone(actual); mutate(changed); assert.equal(matchesMicrosoftRsvp(saved, changed, fixture.state.master), false); }
        for (const mutate of [
          (n: typeof master) => { n.responseStatus.response = "accepted"; },
          (n: typeof master) => { n.subject = "Changed series"; },
          (n: typeof master) => { n.recurrence.pattern.interval = 2; },
          (n: typeof master) => { n.attendees[1]!.status.response = "declined"; },
        ]) { const changed = structuredClone(fixture.state.master); mutate(changed); assert.equal(matchesMicrosoftRsvp(saved, actual, changed), false); }
        if (saved.native.type === "exception") { const changed = { ...actual, type: "occurrence" }; assert.equal(matchesMicrosoftRsvp(saved, changed, fixture.state.master), false); }
        fixture.state.master.subject = "Concurrent series edit";
        assert.equal((await session.write(saved, true, async () => { throw Error("must not resend"); }, async () => {})).kind, "unconfirmed");
        assert.equal(fixture.state.posts, 1);
      } finally { await fixture.close(); }
    }
    for (const mutation of ["parent-content", "parent-response", "slot", "missing-parent", "self-on-master"] as const) {
      const fixture = await graphRsvpFixture(true);
      try {
        const binding = { externalSeriesID: "series", originalStart: { kind: "instant" as const, value: fixture.state.native.originalStart! } };
        const session = await graphRsvpSession("fixture", "account", "calendar");
        const saved = (await session.read("meeting", "accepted", binding))!;
        if (mutation === "parent-content") fixture.state.master.subject = "Concurrent series edit";
        if (mutation === "parent-response") fixture.state.master.responseStatus.response = "accepted";
        if (mutation === "slot") fixture.state.native.originalStart = "2026-03-29T08:00:00.000Z";
        if (mutation === "missing-parent") fixture.state.master.id = "different";
        if (mutation === "self-on-master") fixture.state.master.attendees[0]!.emailAddress.address = "another@example.test";
        await assert.rejects(() => session.write(saved, false, async () => { throw Error("must not dispatch"); }, async () => {}));
        assert.equal(fixture.state.posts, 0);
      } finally { await fixture.close(); }
    }
    console.log("Graph RSVP fake HTTP: three actions, exact body, persisted dispatch fence, lost response/read-only recovery, accepted-unobserved, decline absence, unrelated change, self/grant/flag refusals: OK");
  } finally { config.api.providerRsvpEditsEnabled = previous; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
