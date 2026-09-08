import assert from "node:assert/strict";
import { civilToInstant, instantToCivil } from "./time-zone";

const cases = [
  ["Europe/Prague", "2026-03-29T02:30:00", "2026-03-29T01:30:00.000Z", true],
  ["Europe/Prague", "2026-10-25T02:30:00", "2026-10-25T00:30:00.000Z", false],
  ["America/New_York", "2026-03-08T02:30:00", "2026-03-08T07:30:00.000Z", true],
  [
    "America/New_York",
    "2026-11-01T01:30:00",
    "2026-11-01T05:30:00.000Z",
    false,
  ],
  [
    "Australia/Lord_Howe",
    "2026-10-04T02:15:00",
    "2026-10-03T15:45:00.000Z",
    true,
  ],
  [
    "Australia/Lord_Howe",
    "2026-04-05T01:45:00",
    "2026-04-04T14:45:00.000Z",
    false,
  ],
  ["Pacific/Apia", "2011-12-30T12:00:00", "2011-12-30T22:00:00.000Z", true],
] as const;
for (const [zone, civil, expected, gap] of cases) {
  assert.equal(
    civilToInstant(civil, zone, "explicit")?.toISOString(),
    expected,
    `${zone} explicit ${civil}`,
  );
  assert.equal(
    civilToInstant(civil, zone, "recurrence")?.toISOString() ?? null,
    gap ? null : expected,
    `${zone} recurrence ${civil}`,
  );
}
// Different DST transition weeks: the event zone determines the instant.
for (const [civil, prague, newYork] of [
  [
    "2026-03-01T09:00:00",
    "2026-03-01T08:00:00.000Z",
    "2026-03-01T14:00:00.000Z",
  ],
  [
    "2026-03-15T09:00:00",
    "2026-03-15T08:00:00.000Z",
    "2026-03-15T13:00:00.000Z",
  ],
  [
    "2026-04-05T09:00:00",
    "2026-04-05T07:00:00.000Z",
    "2026-04-05T13:00:00.000Z",
  ],
]) {
  assert.equal(
    civilToInstant(civil, "Europe/Prague", "recurrence")?.toISOString(),
    prague,
  );
  assert.equal(
    civilToInstant(civil, "America/New_York", "recurrence")?.toISOString(),
    newYork,
  );
}
for (const zone of [
  "UTC",
  "Europe/Prague",
  "America/New_York",
  "Asia/Kathmandu",
]) {
  const instant = new Date("2026-09-07T09:23:45.123Z");
  const civil = instantToCivil(instant, zone);
  assert.equal(
    civilToInstant(civil, zone, "explicit")?.getTime(),
    instant.getTime(),
  );
}
assert.throws(() => civilToInstant("2026-02-30T09:00:00", "UTC", "explicit"));
assert.throws(() => civilToInstant("2026-09-07T09:00:00Z", "UTC", "explicit"));
assert.throws(() =>
  civilToInstant("2026-09-07T09:00:00", "Mars/Olympus", "explicit"),
);
assert.throws(() => instantToCivil(new Date(NaN), "UTC"));

// A resolved spring-gap instant is not a reversible representation of DTSTART.
// Preserve the original wall clock instead of anchoring tomorrow at 03:30.
const originalCivil = "2026-03-29T02:30:00.000";
const resolvedGap = civilToInstant(originalCivil, "Europe/Prague", "explicit")!;
assert.equal(
  instantToCivil(resolvedGap, "Europe/Prague"),
  "2026-03-29T03:30:00.000",
);
assert.notEqual(instantToCivil(resolvedGap, "Europe/Prague"), originalCivil);
assert.equal(
  civilToInstant(
    originalCivil.replace("03-29", "03-30"),
    "Europe/Prague",
    "recurrence",
  )?.toISOString(),
  "2026-03-30T00:30:00.000Z",
);

console.log(
  `Exact timezone conversion: OK (host TZ=${process.env.TZ ?? "default"})`,
);
