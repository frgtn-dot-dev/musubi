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
    const native = graphRsvpNative(), evidence = microsoftRsvpEvidence(native, "self@example.test", "accepted");
    native.responseStatus.response = "accepted"; native.attendees[0]!.status.response = "accepted";
    assert.equal(matchesMicrosoftRsvp(evidence, native), true); native.customPreserved.value = "different"; assert.equal(matchesMicrosoftRsvp(evidence, native), false);
    console.log("Graph RSVP fake HTTP: three actions, exact body, persisted dispatch fence, lost response/read-only recovery, accepted-unobserved, decline absence, unrelated change, self/grant/flag refusals: OK");
  } finally { config.api.providerRsvpEditsEnabled = previous; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
