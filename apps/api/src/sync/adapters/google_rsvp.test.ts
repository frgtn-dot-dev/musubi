import assert from "node:assert/strict";
import { googleRsvpEvidence, confirmGoogleRsvp } from "./google_rsvp";
const original = {
  id: "native-event", etag: '\"v1\"', status: "confirmed", updated: "2026-09-08T10:00:00Z",
  summary: "Meeting", description: "Private details", location: "Room",
  start: { dateTime: "2026-10-25T02:30:00+01:00", timeZone: "Europe/Prague" },
  end: { dateTime: "2026-10-25T03:30:00+01:00", timeZone: "Europe/Prague" },
  organizer: { email: "host@example.test", self: false },
  attendees: [{ email: "Guest@example.test", self: true, responseStatus: "needsAction", comment: "Keep comment", additionalGuests: 1 }, { email: "other@example.test", responseStatus: "accepted", optional: true }],
  reminders: { useDefault: false, overrides: [{ method: "email", minutes: 30 }] },
  conferenceData: { conferenceId: "keep", entryPoints: [{ uri: "https://meet.example.test/keep" }] },
  extendedProperties: { private: { unknown: "preserve" } }, sequence: 7,
};
const expected = { eventId: original.id, etag: original.etag, authenticatedCopyEmail: "guest@example.test" };
for (const response of ["accepted", "tentative", "declined"] as const) {
  const evidence = googleRsvpEvidence(original, expected, response);
  assert.deepEqual(evidence.patch, { attendeesOmitted: true, attendees: [{ email: "Guest@example.test", responseStatus: response }] });
  const after = structuredClone(original);
  after.attendees[0]!.responseStatus = response; after.etag = '\"v2\"'; after.updated = "2026-09-08T10:01:00Z";
  assert.deepEqual(confirmGoogleRsvp(after, evidence), { etag: '\"v2\"' });
  for (const mutate of [
    (value: typeof after) => { value.start.timeZone = "Europe/Berlin"; },
    (value: typeof after) => { value.end.dateTime = "2026-10-25T04:30:00+01:00"; },
    (value: typeof after) => { value.summary = "Changed"; },
    (value: typeof after) => { value.attendees[1]!.responseStatus = "declined"; },
    (value: typeof after) => { value.attendees[0]!.comment = "lost"; },
    (value: typeof after) => { value.attendees.pop(); },
    (value: typeof after) => { value.reminders.useDefault = true; },
    (value: typeof after) => { value.conferenceData.conferenceId = "changed"; },
    (value: typeof after) => { value.extendedProperties.private.unknown = "lost"; },
    (value: typeof after) => { value.sequence++; },
  ]) { const changed = structuredClone(after); mutate(changed); assert.throws(() => confirmGoogleRsvp(changed, evidence)); }
  assert.throws(() => confirmGoogleRsvp({ ...after, attendeesOmitted: true }, evidence));
  assert.throws(() => confirmGoogleRsvp({ ...after, etag: 'W/"v2"' }, evidence));
  assert.throws(() => confirmGoogleRsvp(original, evidence));
}
for (const input of [
  { ...original, organizer: { email: "guest@example.test" } },
  { ...original, organizer: { email: "host@example.test", self: true } },
  { ...original, attendeesOmitted: true }, { ...original, privateCopy: true }, { ...original, locked: true },
  { ...original, eventType: "focusTime" }, { ...original, status: "cancelled" },
  { ...original, recurrence: ["RRULE:FREQ=DAILY"] }, { ...original, recurringEventId: "master" },
  { ...original, originalStartTime: original.start },
  { ...original, attendees: original.attendees.map(item => ({ ...item, self: false })) },
  { ...original, attendees: original.attendees.map(item => ({ ...item, self: true })) },
  { ...original, attendees: [...original.attendees, { email: "guest@example.test", responseStatus: "accepted" }] },
  { ...original, attendees: [{ ...original.attendees[0], resource: true }] },
  { ...original, attendees: [{ ...original.attendees[0], organizer: true }] },
  { ...original, attendees: Array.from({ length: 201 }, () => original.attendees[0]) },
  { ...original, start: { date: "2026-02-30" } }, { ...original, end: original.start }, { ...original, end: { date: "2026-10-26" } }, { ...original, etag: 'W/"v1"' },
]) assert.throws(() => googleRsvpEvidence(input, expected, "accepted"));
for (const override of [{ eventId: "different" }, { etag: '\"stale\"' }, { authenticatedCopyEmail: "other@example.test" }, { authenticatedCopyEmail: "" }])
  assert.throws(() => googleRsvpEvidence(original, { ...expected, ...override }, "accepted"));
const allDay = { ...original, start: { date: "2026-09-08" }, end: { date: "2026-09-09" } };
const frozen = googleRsvpEvidence(allDay, expected, "accepted");
allDay.summary = "Changed after capture";
assert.equal(frozen.baseline.summary, "Meeting");
assert.equal(original.attendees[0]!.responseStatus, "needsAction");
console.log("Google RSVP evidence: own identity, minimal patch, full preservation, stale/unsupported refusal: OK");

// A caller must bind both accepted parent and original slot. Moved DTSTART is
// deliberately different, including the repeated hour at the autumn DST fold.
for (const originalStartTime of [
  { date: "2026-10-24" },
  { dateTime: "2026-10-25T02:30:00+02:00", timeZone: "Europe/Prague" },
]) {
  const originalStart = "date" in originalStartTime
    ? { kind: "date" as const, value: originalStartTime.date! }
    : { kind: "instant" as const, value: "2026-10-25T00:30:00.000Z" };
  const occurrence = { externalSeriesID: "series", originalStart };
  const instance = { ...original, ...(originalStart.kind === "date" ? { start: { date: "2026-10-26" }, end: { date: "2026-10-27" } } : {}), recurringEventId: "series", originalStartTime };
  const bound = { ...expected, occurrence };
  for (const response of ["accepted", "tentative", "declined"] as const) {
    const proof = googleRsvpEvidence(instance, bound, response);
    const after = structuredClone(instance); after.etag = '\"instance-v2\"'; after.attendees[0]!.responseStatus = response;
    assert.deepEqual(confirmGoogleRsvp(after, proof), { etag: after.etag });
    assert.deepEqual(proof.occurrence, occurrence);
    assert.throws(() => confirmGoogleRsvp({ ...after, recurringEventId: "different" }, proof));
    assert.throws(() => confirmGoogleRsvp({ ...after, originalStartTime: after.start }, proof));
    assert.throws(() => confirmGoogleRsvp({ ...after, originalStartTime: undefined }, proof));
    assert.throws(() => confirmGoogleRsvp({ ...after, recurrence: ["RRULE:FREQ=DAILY"] }, proof));
  }
  assert.throws(() => googleRsvpEvidence(instance, expected, "accepted"));
  assert.throws(() => googleRsvpEvidence(original, bound, "accepted"));
  for (const changed of [
    { ...instance, recurringEventId: undefined }, { ...instance, originalStartTime: undefined },
    { ...instance, recurringEventId: "different" }, { ...instance, recurringEventId: instance.id },
    { ...instance, recurrence: ["RRULE:FREQ=DAILY"] },
    { ...instance, originalStartTime: instance.start },
    { ...instance, originalStartTime: { dateTime: "2026-10-25T02:30:00" } },
    { ...instance, originalStartTime: { dateTime: "2026-10-25T00:30:00.0001Z" } },
    { ...instance, originalStartTime: { date: "2026-10-25", dateTime: "2026-10-25T00:30:00Z" } },
  ]) assert.throws(() => googleRsvpEvidence(changed, bound, "accepted"));
  const proof = googleRsvpEvidence(instance, bound, "accepted");
  occurrence.externalSeriesID = "mutated";
  assert.equal(proof.occurrence?.externalSeriesID, "series");
}
console.log("Google instance RSVP evidence: accepted parent/original identity, DST fold and moved-time preservation: OK");
