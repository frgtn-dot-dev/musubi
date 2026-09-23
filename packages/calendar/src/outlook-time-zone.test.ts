import assert from "node:assert/strict";
import { OUTLOOK_WINDOWS_ZONES } from "./outlook-windows-zones";
import { canonicalTimeZone, outlookSeriesTimeZone, outlookTimeZoneMatches, shiftCivilMinutes } from "./outlook-time-zone";
import { unambiguousCivilToInstant } from "./time-zone";
const labels = (zone: string) => ({ recurrenceTimeZone: zone, originalStartTimeZone: zone, originalEndTimeZone: zone });
for (const [name, mapping] of Object.entries(OUTLOOK_WINDOWS_ZONES)) {
  assert.ok(mapping.zones.includes(mapping.default));
  if (canonicalTimeZone(mapping.default)) assert.equal(canonicalTimeZone(outlookSeriesTimeZone(labels(name))), canonicalTimeZone(mapping.default));
  for (const zone of mapping.zones.filter(zone => canonicalTimeZone(zone))) {
    assert.ok(outlookTimeZoneMatches(name, zone), `${name}: ${zone}`);
    assert.equal(outlookSeriesTimeZone({ ...labels(zone), recurrenceTimeZone: name }), zone);
    assert.equal(outlookSeriesTimeZone(labels(name), zone), zone);
  }
}
assert.equal(outlookSeriesTimeZone(labels("Eastern Standard Time")), "America/New_York");
assert.equal(outlookSeriesTimeZone(labels("Central Europe Standard Time")), "Europe/Budapest");
assert.equal(outlookSeriesTimeZone({ ...labels("Central Europe Standard Time"), originalStartTimeZone: "Europe/Prague" }), "Europe/Prague");
assert.equal(outlookSeriesTimeZone({ ...labels("Europe/Prague"), recurrenceTimeZone: "Central Europe Standard Time" }, "Europe/Budapest"), undefined);
assert.ok(outlookTimeZoneMatches("Nepal Standard Time", "Asia/Kathmandu"));
assert.ok(outlookTimeZoneMatches("India Standard Time", "Asia/Kolkata"));
assert.ok(!outlookTimeZoneMatches("Eastern Standard Time", "America/Lima"), "Equal offsets today are not zone evidence");
for (const bad of ["tzone://Microsoft/Custom", "Not/AZone", "+05:45", "constructor", "__proto__"])
  assert.equal(outlookSeriesTimeZone(labels(bad)), undefined);
assert.equal(outlookSeriesTimeZone({ ...labels("Eastern Standard Time"), originalEndTimeZone: "Pacific Standard Time" }), undefined);
assert.equal(outlookSeriesTimeZone({ ...labels("Asia/Tokyo"), recurrenceTimeZone: undefined }), undefined);
assert.equal(shiftCivilMinutes("2026-12-31T23:45:00", 30), "2027-01-01T00:15:00.000");
assert.equal(shiftCivilMinutes("2028-03-01T00:15:00", -30), "2028-02-29T23:45:00.000");
for (const [zone, civil] of [
  ["America/New_York", "2026-03-08T02:30:00"], ["America/New_York", "2026-11-01T01:30:00"],
  ["Europe/Prague", "2026-03-29T02:30:00"], ["Europe/Prague", "2026-10-25T02:30:00"],
  ["Australia/Sydney", "2026-10-04T02:30:00"], ["Australia/Sydney", "2026-04-05T02:30:00"],
  ["Australia/Lord_Howe", "2026-10-04T02:15:00"], ["Australia/Lord_Howe", "2026-04-05T01:45:00"],
  ["Pacific/Apia", "2011-12-30T12:00:00"],
]) assert.throws(() => unambiguousCivilToInstant(civil!, zone!), `${zone}: ${civil}`);
console.log("Outlook zones: every CLDR Windows mapping, IANA aliases, explicit-zone precedence, rejected custom/mixed labels, civil boundaries and global gaps/folds OK");
