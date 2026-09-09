import assert from "node:assert/strict";
import { EventSchema } from "@musubi/types";
import { finiteSeriesFootprint, recurrenceUntilEndDate } from "./finite-series";
import { resolveEventTimeEdit } from "./time-edit";
const base = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000181", creatorID: "owner", organizer: "", title: "Finite", color: "red", calendars: [], isCanceled: false, recurrence: "FREQ=DAILY;COUNT=4", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-27T09:00:00", endLocal: "2026-03-27T10:00:00" }) });
const before = JSON.stringify(base);
for (const zone of ["UTC", "America/New_York", "Asia/Tokyo"]) {
  const saved = process.env.TZ;
  try {
    process.env.TZ = zone;
    const expected = ["2026-03-27T08:00:00.000Z", "2026-03-28T08:00:00.000Z", "2026-03-29T07:00:00.000Z", "2026-03-30T07:00:00.000Z"];
    for (const until of ["20260330T070000Z", "20260330T070001Z", "20260330T215959Z"])
      assert.deepEqual(finiteSeriesFootprint({ ...base, recurrence: `FREQ=DAILY;UNTIL=${until}` }).map(slot => slot.originalStart.value), expected);
    assert.deepEqual(finiteSeriesFootprint({ ...base, recurrence: "FREQ=DAILY;UNTIL=20260330T065959Z" }).map(slot => slot.originalStart.value), expected.slice(0, 3));
  } finally { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; }
}
const dates = { ...base, ...resolveEventTimeEdit({ kind: "all-day", startDate: "2026-12-30", endDate: "2026-12-31" }) };
assert.deepEqual(finiteSeriesFootprint({ ...dates, recurrence: "FREQ=DAILY;UNTIL=20270102" }), finiteSeriesFootprint(dates));
const east = { ...base, ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Asia/Tokyo", startLocal: "2026-03-27T00:30:00", endLocal: "2026-03-27T01:30:00" }) };
assert.equal(recurrenceUntilEndDate(east, "20260329T152959Z"), "2026-03-29");
assert.equal(recurrenceUntilEndDate(east, "20260329T153000Z"), "2026-03-30");
assert.equal(finiteSeriesFootprint({ ...east, recurrence: "FREQ=DAILY;UNTIL=20260329T153000Z" }).length, 4);
// End dates need not be pattern dates; finite range slack does not add a slot.
const weekly = { ...base, recurrence: "FREQ=WEEKLY;UNTIL=20260406T120000Z" };
assert.equal(finiteSeriesFootprint(weekly).length, 2);
for (const recurrence of ["FREQ=DAILY", "FREQ=DAILY;COUNT=0", "FREQ=DAILY;COUNT=367", "FREQ=YEARLY;UNTIL=20300327T080000Z", "FREQ=DAILY;UNTIL=20280326T080001Z", "FREQ=DAILY;UNTIL=20260230T080000Z", "FREQ=DAILY;UNTIL=20260326T080000Z", "FREQ=DAILY;UNTIL=20260330", "FREQ=DAILY;COUNT=4;UNTIL=20260330T070000Z", "FREQ=DAILY;UNTIL=20260330T070000Z;UNTIL=20260330T070000Z"]) assert.throws(() => finiteSeriesFootprint({ ...base, recurrence }));
assert.equal(JSON.stringify(base), before);
console.log("Finite COUNT/UNTIL proof: inclusive cutoff, civil/UTC dates, DST, complete horizon and immutable original intent: OK");
