import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CaldavOrganizerRequestSchema } from "@musubi/types";
import {
  caldavOrganizerDesired,
  caldavOrganizerNative,
  matchesCaldavOrganizer,
} from "./caldav_organizer";
import { caldavOrganizerTimeEvidence } from "./caldav_organizer_time";
import {
  caldavRsvpFixtureData,
  caldavRsvpDstDurationData,
} from "./caldav_organizer.fixture";
const proof = {
  principal: "https://fixture.test/principal/",
  owner: "https://fixture.test/principal/",
  outbox: "https://fixture.test/outbox/",
  addresses: ["mailto:self@example.test"],
};
const data = (value: string) =>
  value
    .replace("mailto:organizer@example.test", "mailto:self@example.test")
    .replace("CN=Self;PARTSTAT=NEEDS-ACTION", "CN=Self;PARTSTAT=ACCEPTED");
const baseline = (value: string) => ({
  id: "https://fixture.test/calendar/meeting.ics",
  iCalUID: "rsvp-fixture",
  etag: '"before"',
  scheduleTag: '"schedule-before"',
  proof,
  data: data(value),
});
const request = (time: unknown) =>
  CaldavOrganizerRequestSchema.parse({
    provider: "caldav",
    notificationPolicy: "server-invite",
    operationID: randomUUID(),
    calendarID: randomUUID(),
    eventID: randomUUID(),
    action: "update",
    expectedRevision: 1,
    expectedStateVersion: "a".repeat(64),
    patch: { time },
  });
const timed = (timeZone: string, startLocal: string, endLocal: string) => ({
  kind: "zoned",
  timeZone,
  startLocal,
  endLocal,
});
const utc = timed("UTC", "2026-03-28T11:00:00", "2026-03-28T12:00:00");
const before = baseline(caldavRsvpFixtureData);
const desired = caldavOrganizerDesired(
  "https://fixture.test/calendar/",
  request(utc),
  before,
  proof,
  "20260301T100000Z",
)!;
assert.equal(desired.rescheduled, true);
assert.ok(desired.data.includes("SEQUENCE:3\r\n"));
assert.ok(desired.data.includes("DTSTAMP:20260301T100000Z\r\n"));
assert.ok(
  desired.data.includes(
    "CN=Self;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:self@example.test",
  ),
  "organizer attendee bytes stay exact",
);
assert.ok(
  desired.data.includes(
    "CN=Other;PARTSTAT=NEEDS-ACTION:mailto:other@example.test",
  ),
);
assert.ok(desired.data.includes("X-PRIVATE;X-KEEP=yes:Folded\r\n extension"));
assert.ok(
  desired.data.includes("BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M"),
);
const observed = {
  ...before,
  data: desired.data,
  etag: '"after"',
  scheduleTag: '"schedule-after"',
};
assert.equal(matchesCaldavOrganizer(observed, desired, before), true);
for (const changed of [
  { ...observed, data: desired.data.replace("SEQUENCE:3", "SEQUENCE:2") },
  {
    ...observed,
    data: desired.data.replace("DTSTAMP:20260301T100000Z\r\n", ""),
  },
  { ...observed, scheduleTag: before.scheduleTag },
  { ...observed, etag: before.etag },
  {
    ...observed,
    data: desired.data.replace(
      "CN=Other;PARTSTAT=NEEDS-ACTION",
      "CN=Other;PARTSTAT=ACCEPTED",
    ),
  },
  { ...observed, data: desired.data.replace("X-KEEP=yes", "X-KEEP=no") },
])
  assert.equal(matchesCaldavOrganizer(changed, desired, before), false);
const noop = caldavOrganizerDesired(
  "https://fixture.test/calendar/",
  request(timed("UTC", "2026-03-28T09:00:00", "2026-03-28T10:00:00")),
  before,
  proof,
  "20260301T100000Z",
)!;
assert.equal(noop.data, before.data);
assert.equal(noop.rescheduled, undefined);
const zoned = baseline(caldavRsvpDstDurationData);
const moved = caldavOrganizerDesired(
  "https://fixture.test/calendar/",
  request(timed("Europe/Prague", "2026-03-29T09:00:00", "2026-03-30T09:00:00")),
  zoned,
  proof,
  "20260301T100000Z",
)!;
assert.ok(!moved.data.includes("DURATION:"));
assert.ok(moved.data.includes("DTEND;TZID=Europe/Prague:20260330T090000"));
assert.equal(
  moved.data.split("BEGIN:VTIMEZONE")[1]!.split("END:VTIMEZONE")[0],
  zoned.data.split("BEGIN:VTIMEZONE")[1]!.split("END:VTIMEZONE")[0],
);
assert.equal(
  caldavOrganizerNative({
    ...zoned,
    data: moved.data,
  }).projection.start.toISOString(),
  "2026-03-29T07:00:00.000Z",
);
for (const time of [
  timed("Europe/Prague", "2026-03-29T02:30:00", "2026-03-29T04:00:00"),
  timed("Europe/Prague", "2026-10-25T02:30:00", "2026-10-25T04:00:00"),
  utc,
  { kind: "all-day", startDate: "2026-03-29", endDate: "2026-03-29" },
])
  assert.throws(() =>
    caldavOrganizerDesired(
      "https://fixture.test/calendar/",
      request(time),
      zoned,
      proof,
      "20260301T100000Z",
    ),
  );
for (const invalid of [
  zoned.data.replace(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r\n/, ""),
  zoned.data.replace("TZOFFSETTO:+0200", "TZOFFSETTO:+0300"),
  zoned.data.replace("DURATION:PT24H", "DURATION;X-KEEP=yes:PT24H"),
])
  assert.throws(() => caldavOrganizerTimeEvidence(invalid));
const day = baseline(
  caldavRsvpFixtureData
    .replace("DTSTART:20260328T090000Z", "DTSTART;VALUE=DATE:20260328")
    .replace("DTEND:20260328T100000Z", "DTEND;VALUE=DATE:20260329"),
);
const allDay = caldavOrganizerDesired(
  "https://fixture.test/calendar/",
  request({ kind: "all-day", startDate: "2026-10-24", endDate: "2026-10-25" }),
  day,
  proof,
  "20260301T100000Z",
)!;
assert.ok(allDay.data.includes("DTEND;VALUE=DATE:20261026"));
assert.throws(() =>
  caldavOrganizerDesired(
    "https://fixture.test/calendar/",
    request(utc),
    day,
    proof,
    "20260301T100000Z",
  ),
);
console.log(
  "CalDAV organizer retiming: exact same-zone endpoints, DST/native timezone proof, deterministic response reset, strict sequence/full ACK and real no-op: OK",
);

const durationNoop = caldavOrganizerDesired(
  "https://fixture.test/calendar/",
  request(timed("Europe/Prague", "2026-03-28T09:00:00", "2026-03-29T10:00:00")),
  zoned,
  proof,
  "20260301T100000Z",
)!;
assert.equal(durationNoop.data, zoned.data);
assert.equal(durationNoop.rescheduled, undefined);
const futureMismatch = baseline(
  caldavRsvpDstDurationData
    .replace("20260328T090000", "20260301T090000")
    .replace("TZOFFSETTO:+0200", "TZOFFSETTO:+0300"),
);
assert.doesNotThrow(() => caldavOrganizerTimeEvidence(futureMismatch.data));
assert.throws(() =>
  caldavOrganizerDesired(
    "https://fixture.test/calendar/",
    request(
      timed("Europe/Prague", "2026-03-29T11:00:00", "2026-03-29T12:00:00"),
    ),
    futureMismatch,
    proof,
    "20260301T100000Z",
  ),
);
assert.equal(
  matchesCaldavOrganizer(
    {
      ...observed,
      data: desired.data
        .replace("SEQUENCE:3", "SEQUENCE:4")
        .replace("DTSTAMP:20260301T100000Z", "DTSTAMP:20260301T110000Z"),
    },
    desired,
    before,
  ),
  true,
);
const nominal = baseline(
  caldavRsvpDstDurationData.replace("DURATION:PT24H", "DURATION:P1D"),
);
assert.equal(
  caldavOrganizerNative(nominal).projection.end.toISOString(),
  "2026-03-29T07:00:00.000Z",
);
assert.ok(
  caldavOrganizerDesired(
    "https://fixture.test/calendar/",
    request(
      timed("Europe/Prague", "2026-03-29T11:00:00", "2026-03-30T11:00:00"),
    ),
    nominal,
    proof,
    "20260301T100000Z",
  )!.data.includes("DTEND;TZID=Europe/Prague:20260330T110000"),
);

// Native rollback differs from IANA: Oct 26 is unique in IANA, but the embedded
// definition gives 02:30 two instants. Check both requested and saved endpoints.
const nativeFold = baseline(
  caldavRsvpDstDurationData.replace(
    "BYMONTH=10;BYDAY=-1SU",
    "BYMONTH=10;BYMONTHDAY=26",
  ),
);
assert.doesNotThrow(() => caldavOrganizerTimeEvidence(nativeFold.data));
assert.throws(() =>
  caldavOrganizerDesired(
    "https://fixture.test/calendar/",
    request(
      timed("Europe/Prague", "2026-10-26T02:30:00", "2026-10-26T04:00:00"),
    ),
    nativeFold,
    proof,
    "20260301T100000Z",
  ),
);
assert.throws(() =>
  caldavOrganizerTimeEvidence(
    nativeFold.data.replace("20260328T090000", "20261026T023000"),
  ),
);
// The end endpoint and the entire half-open fold interval are checked too.
assert.throws(() =>
  caldavOrganizerDesired(
    "https://fixture.test/calendar/",
    request(
      timed("Europe/Prague", "2026-10-26T01:30:00", "2026-10-26T02:59:59"),
    ),
    nativeFold,
    proof,
    "20260301T100000Z",
  ),
);
assert.doesNotThrow(() =>
  caldavOrganizerDesired(
    "https://fixture.test/calendar/",
    request(
      timed("Europe/Prague", "2026-10-26T03:00:00", "2026-10-26T04:00:00"),
    ),
    nativeFold,
    proof,
    "20260301T100000Z",
  ),
);
const multipleDates = zoned.data.replace(
  "END:DAYLIGHT",
  "RDATE:20260329T020000,20261201T020000\r\nEND:DAYLIGHT",
);
assert.throws(() => caldavOrganizerTimeEvidence(multipleDates));
assert.throws(() =>
  caldavOrganizerDesired(
    "https://fixture.test/calendar/",
    request(
      timed("Europe/Prague", "2026-12-01T09:00:00", "2026-12-01T10:00:00"),
    ),
    { ...zoned, data: multipleDates },
    proof,
    "20260301T100000Z",
  ),
);
assert.doesNotThrow(() =>
  caldavOrganizerTimeEvidence(
    zoned.data.replace("END:DAYLIGHT", "RDATE:20260329T020000\r\nEND:DAYLIGHT"),
  ),
);
console.log(
  "Native fold old/new/endpoints and multi-value timezone RDATE refusals: OK",
);

const winter = baseline(
  caldavRsvpDstDurationData.replace("20260328T090000", "20260301T090000"),
);
const april = request(
  timed("Europe/Prague", "2026-04-01T09:00:00", "2026-04-01T10:00:00"),
);
for (const value of [
  "+020030",
  "+020030junk",
  "+0200junk",
  "+0260",
  "+2900",
  "-2500",
  "+2400",
  "-0000",
  "0200",
  "+02:00",
  "+0200000",
]) {
  for (const name of ["TZOFFSETFROM", "TZOFFSETTO"]) {
    const invalid = winter.data.replace(
      new RegExp(`${name}:\\+0200`),
      `${name}:${value}`,
    );
    assert.notEqual(invalid, winter.data);
    assert.throws(
      () => caldavOrganizerTimeEvidence(invalid),
      `${name}:${value}`,
    );
    assert.throws(() =>
      caldavOrganizerDesired(
        "https://fixture.test/calendar/",
        april,
        { ...winter, data: invalid },
        proof,
        "20260301T100000Z",
      ),
    );
  }
}
for (const offset of ["+0200", "+020000", "+02\r\n 00"]) {
  const valid = {
    ...winter,
    data: winter.data.replace("TZOFFSETTO:+0200", `TZOFFSETTO:${offset}`),
  };
  assert.doesNotThrow(() => caldavOrganizerTimeEvidence(valid.data));
  const accepted = caldavOrganizerDesired(
    "https://fixture.test/calendar/",
    april,
    valid,
    proof,
    "20260301T100000Z",
  )!;
  assert.ok(accepted.data.includes(`TZOFFSETTO:${offset}\r\n`));
}
console.log(
  "Raw timezone offsets: seconds/truncation/wrapping refused; minute and zero-second bytes preserved: OK",
);
