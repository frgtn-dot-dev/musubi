import assert from "node:assert/strict";
import {
  CivilDateTimeSchema,
  EventTimeModelSchema,
  OccurrenceStartSchema,
  occurrenceKey,
} from "./event_time";

for (const timeZone of [
  "UTC",
  "Europe/Prague",
  "America/New_York",
  "Australia/Lord_Howe",
]) {
  assert.equal(
    EventTimeModelSchema.parse({ kind: "zoned", timeZone }).kind,
    "zoned",
  );
}
for (const timeZone of ["", "+01:00", "Mars/Olympus", "Europe/NotPrague"]) {
  assert.equal(
    EventTimeModelSchema.safeParse({ kind: "zoned", timeZone }).success,
    false,
  );
}
for (const value of [
  "2026-02-30T09:00:00",
  "2026-09-07T09:00:00Z",
  "2026-09-07T09:00:00+02:00",
  "2026-09-07",
  "2026-09-07T09:00:00.0001",
]) {
  assert.equal(CivilDateTimeSchema.safeParse(value).success, false, value);
}
assert.equal(
  CivilDateTimeSchema.parse("2026-09-07T09:00:00"),
  "2026-09-07T09:00:00.000",
);
assert.equal(
  CivilDateTimeSchema.parse("2026-09-07T09:00:00.1"),
  "2026-09-07T09:00:00.100",
);
assert.equal(
  EventTimeModelSchema.safeParse({
    kind: "floating",
    startLocal: "2026-09-07T09:00:00.000",
    endLocal: "2026-09-07T09:00:00",
  }).success,
  true,
);
assert.equal(
  EventTimeModelSchema.safeParse({
    kind: "floating",
    startLocal: "2026-09-07T10:00:00",
    endLocal: "2026-09-07T09:00:00",
  }).success,
  false,
);
assert.equal(
  EventTimeModelSchema.safeParse({ kind: "all-day", timeZone: "UTC" }).success,
  false,
);
assert.equal(
  EventTimeModelSchema.safeParse({ kind: "legacy-unknown", timeZone: "UTC" })
    .success,
  false,
);
assert.deepEqual(
  OccurrenceStartSchema.parse({
    kind: "instant",
    value: "2026-09-07T09:00:00Z",
  }),
  { kind: "instant", value: "2026-09-07T09:00:00.000Z" },
);
assert.equal(
  OccurrenceStartSchema.safeParse({
    kind: "instant",
    value: "2026-09-07T09:00:00.0001Z",
  }).success,
  false,
);
assert.equal(
  OccurrenceStartSchema.safeParse({ kind: "date", value: "2026-02-29" })
    .success,
  false,
);
assert.deepEqual(
  OccurrenceStartSchema.parse({ kind: "date", value: "2028-02-29" }),
  { kind: "date", value: "2028-02-29" },
);

const seriesId = "00000000-0000-4000-8000-000000000001";
const key = occurrenceKey({
  seriesId,
  originalStart: { kind: "instant", value: "2026-09-07T09:00:00Z" },
});
assert.equal(
  key,
  occurrenceKey({
    seriesId,
    originalStart: { kind: "instant", value: "2026-09-07T09:00:00.000Z" },
  }),
);
assert.notEqual(
  key,
  occurrenceKey({
    seriesId,
    originalStart: { kind: "floating", value: "2026-09-07T09:00:00" },
  }),
);
assert.notEqual(
  key,
  occurrenceKey({
    seriesId: "00000000-0000-4000-8000-000000000002",
    originalStart: { kind: "instant", value: "2026-09-07T09:00:00Z" },
  }),
);
assert.equal(
  key,
  occurrenceKey(
    JSON.parse(
      JSON.stringify({
        seriesId,
        originalStart: { kind: "instant", value: "2026-09-07T09:00:00Z" },
      }),
    ),
  ),
);

assert.equal(
  occurrenceKey({
    seriesId: "AAAAAAAA-0000-4000-8000-000000000001",
    originalStart: { kind: "date", value: "2026-09-07" },
  }),
  occurrenceKey({
    seriesId: "aaaaaaaa-0000-4000-8000-000000000001",
    originalStart: { kind: "date", value: "2026-09-07" },
  }),
);
console.log("Event time contracts: OK");
