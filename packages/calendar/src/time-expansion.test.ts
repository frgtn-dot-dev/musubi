import assert from "node:assert/strict";
import type { ICalendarEventBase } from "./interfaces";
import { expandRecurringEvents, EventExpansionError } from "./recurrence";
import { civilToInstant } from "./time-zone";
const id = "00000000-0000-4000-8000-000000000001";
const exceptionId = "00000000-0000-4000-8000-000000000002";
function zoned(
  startLocal = "2026-03-28T02:30:00.000",
  endLocal = "2026-03-28T03:30:00.000",
  timeZone = "Europe/Prague",
  recurrence = "FREQ=DAILY;COUNT=3",
): ICalendarEventBase {
  return {
    id,
    title: "Series",
    start: civilToInstant(startLocal, timeZone, "explicit")!,
    end: civilToInstant(endLocal, timeZone, "explicit")!,
    isAllDay: false,
    recurrence,
    timeModel: { kind: "zoned", timeZone, startLocal, endLocal },
  };
}
const expand = (
  events: ICalendarEventBase[],
  from = "2026-03-01T00:00:00Z",
  to = "2026-04-10T00:00:00Z",
  consumerTimeZone = "UTC",
) =>
  expandRecurringEvents(events, new Date(from), new Date(to), {
    consumerTimeZone,
  });
const starts = (events: ICalendarEventBase[]) =>
  events.map((event) => event.start.toISOString());
const gapSeries = zoned();
const expectedGap = [
  "2026-03-28T01:30:00.000Z",
  "2026-03-30T00:30:00.000Z",
  "2026-03-31T00:30:00.000Z",
];
for (const zone of ["UTC", "Europe/Prague", "America/New_York"])
  assert.deepEqual(
    starts(expand([gapSeries], undefined, undefined, zone)),
    expectedGap,
  );
assert.equal(
  expand([gapSeries], "2026-03-31T00:00:00Z", "2026-04-05T00:00:00Z").length,
  1,
  "COUNT is reconstructed before a later view window",
);
assert.equal(
  expand([gapSeries], "2026-03-01T00:00:00Z", "2026-03-10T00:00:00Z").length,
  0,
);
const explicitGap = zoned("2026-03-29T02:30:00.000", "2026-03-29T04:30:00.000");
assert.deepEqual(
  starts(expand([explicitGap])),
  [
    "2026-03-29T01:30:00.000Z",
    "2026-03-30T00:30:00.000Z",
    "2026-03-31T00:30:00.000Z",
  ],
  "explicit DTSTART gap is retained without changing future wall clocks",
);
const excluded = {
  ...gapSeries,
  recurrence:
    "RRULE:FREQ=DAILY;COUNT=3\nEXDATE;TZID=Europe/Prague:20260330T023000",
};
assert.deepEqual(
  starts(expand([excluded])),
  [expectedGap[0], expectedGap[2]],
  "EXDATE consumes RRULE count; nonexistent candidates do not",
);
const until = { ...gapSeries, recurrence: "FREQ=DAILY;UNTIL=20260330T003000Z" };
assert.deepEqual(starts(expand([until])), expectedGap.slice(0, 2));
const rdates = {
  ...gapSeries,
  recurrence:
    "RRULE:FREQ=DAILY;COUNT=1\nRDATE:20260330T003000Z,20260330T003000Z\nEXDATE:20260328T013000Z",
};
assert.deepEqual(starts(expand([rdates])), [expectedGap[1]]);
assert.deepEqual(
  starts(
    expand([
      {
        ...gapSeries,
        recurrence:
          "DTSTART;TZID=Europe/Prague:20260328T023000\r\nRRULE:FREQ=DAILY;\r\n COUNT=3",
      },
    ]),
  ),
  expectedGap,
);
const fold = zoned("2026-10-24T02:30:00.000", "2026-10-24T03:30:00.000");
assert.deepEqual(
  starts(expand([fold], "2026-10-23T00:00:00Z", "2026-10-28T00:00:00Z")),
  [
    "2026-10-24T00:30:00.000Z",
    "2026-10-25T00:30:00.000Z",
    "2026-10-26T01:30:00.000Z",
  ],
);
const twoFoldInstants = {
  ...fold,
  recurrence: "RRULE:FREQ=DAILY;COUNT=2\nRDATE:20261025T013000Z",
};
assert.deepEqual(
  starts(
    expand([twoFoldInstants], "2026-10-25T00:00:00Z", "2026-10-25T02:00:00Z"),
  ),
  ["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"],
);
const millis = zoned("2026-03-28T02:30:00.123", "2026-03-28T03:30:00.123");
assert.ok(
  expand([millis]).every((event) => event.start.getUTCMilliseconds() === 123),
);
const month = zoned(
  "2026-01-31T09:00:00.000",
  "2026-01-31T10:00:00.000",
  "UTC",
  "FREQ=MONTHLY;COUNT=3",
);
assert.deepEqual(
  starts(expand([month], "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z")),
  [
    "2026-01-31T09:00:00.000Z",
    "2026-03-31T09:00:00.000Z",
    "2026-05-31T09:00:00.000Z",
  ],
);
const day: ICalendarEventBase = {
  id,
  title: "All day",
  start: new Date("2026-03-28T00:00:00Z"),
  end: new Date("2026-03-30T00:00:00Z"),
  isAllDay: true,
  timeModel: { kind: "all-day" },
  recurrence: "RRULE:FREQ=DAILY;COUNT=3\nEXDATE;VALUE=DATE:20260329",
};
for (const zone of ["UTC", "Europe/Prague", "America/New_York"]) {
  const result = expand([day], undefined, undefined, zone);
  assert.deepEqual(starts(result), [
    "2026-03-28T00:00:00.000Z",
    "2026-03-30T00:00:00.000Z",
  ]);
  assert.equal(result[0].end.toISOString(), "2026-03-30T00:00:00.000Z");
}
const floating: ICalendarEventBase = {
  ...gapSeries,
  timeModel: {
    kind: "floating",
    startLocal: "2026-03-28T02:30:00.000",
    endLocal: "2026-03-28T03:30:00.000",
  },
};
const floatingUTC = expand([floating], undefined, undefined, "UTC");
const floatingNY = expand([floating], undefined, undefined, "America/New_York");
assert.deepEqual(
  floatingUTC.map((event) => event.id),
  floatingNY.map((event) => event.id),
  "floating identity does not depend on viewing zone",
);
assert.notDeepEqual(starts(floatingUTC), starts(floatingNY));
assert.deepEqual(
  starts(expand([floating], undefined, undefined, "Europe/Prague")),
  expectedGap,
);
assert.throws(
  () =>
    expandRecurringEvents(
      [floating],
      new Date("2026-03-01"),
      new Date("2026-04-10"),
    ),
  /floating-consumer-zone-required/,
);
const moved: ICalendarEventBase = {
  ...zoned("2026-04-02T12:00:00.000", "2026-04-02T14:00:00.000"),
  id: exceptionId,
  recurrence: null,
  title: "Moved",
  seriesID: id,
  originalStart: { kind: "instant", value: expectedGap[1] },
};
for (const definitions of [
  [gapSeries, moved],
  [moved, gapSeries],
]) {
  const result = expand(definitions);
  assert.equal(result.length, 3);
  assert.ok(!starts(result).includes(expectedGap[1]));
  assert.equal(
    result.find((event) => event.id === exceptionId)?.title,
    "Moved",
  );
  assert.equal(
    result.find((event) => event.id === exceptionId)?.occurrenceIdentity
      ?.originalStart.value,
    expectedGap[1],
  );
}
assert.equal(
  expand([gapSeries, moved], "2026-04-02T00:00:00Z", "2026-04-03T00:00:00Z")[0]
    .id,
  exceptionId,
  "moved-in exception survives an original start outside the window",
);
assert.equal(expand([gapSeries, { ...moved, isCanceled: true }]).length, 2);
assert.equal(expand([{ ...gapSeries, isCanceled: true }, moved]).length, 0);
const reloaded = JSON.parse(JSON.stringify([gapSeries, moved])).map(
  (event: any) => ({
    ...event,
    start: new Date(event.start),
    end: new Date(event.end),
  }),
);
assert.deepEqual(
  expand(reloaded).map((event) => [event.id, event.occurrenceIdentity]),
  expand([gapSeries, moved]).map((event) => [
    event.id,
    event.occurrenceIdentity,
  ]),
);
for (const rule of [
  "FREQ=HOURLY",
  "FREQ=DAILY;COUNT=2;UNTIL=20260401T000000Z",
  "FREQ=DAILY;COUNT=0",
  "FREQ=DAILY;INTERVAL=0",
  "FREQ=DAILY;COUNT=2;COUNT=3",
  "EXRULE:FREQ=DAILY",
  "RRULE:FREQ=DAILY\nRDATE;VALUE=PERIOD:20260330T000000Z/PT1H",
  "RRULE:FREQ=DAILY\nEXDATE:20260230T000000Z",
])
  assert.throws(
    () => expand([{ ...gapSeries, recurrence: rule }]),
    undefined,
    rule,
  );
assert.throws(
  () =>
    expand([
      gapSeries,
      moved,
      { ...moved, id: "00000000-0000-4000-8000-000000000003" },
    ]),
  /duplicate-occurrence-identity/,
);
assert.throws(
  () => expand([{ ...gapSeries, start: new Date("2026-03-28T06:00:00Z") }]),
  /inconsistent-zoned-endpoint|invalid-event-range/,
);
assert.throws(
  () =>
    expand([
      {
        ...gapSeries,
        recurrence: "DTSTART:20260328T013000Z\nRRULE:FREQ=DAILY",
      },
    ]),
  EventExpansionError,
);
const singleDay = {
  ...day,
  start: new Date("2026-03-28T00:00:00Z"),
  end: new Date("2026-03-28T00:00:00Z"),
  recurrence: null,
};
assert.equal(
  expand(
    [singleDay],
    "2026-03-28T04:00:00Z",
    "2026-03-29T03:59:59Z",
    "America/New_York",
  ).length,
  1,
  "all-day overlap uses consumer dates, not UTC instant overlap",
);
assert.equal(
  expand(
    [singleDay],
    "2026-03-29T04:00:00Z",
    "2026-03-30T03:59:59Z",
    "America/New_York",
  ).length,
  0,
);
assert.deepEqual(
  starts(
    expand([
      {
        ...gapSeries,
        recurrence:
          "rrule:freq=daily;count=3\nexdate;tzid=Europe/Prague:20260330T023000",
      },
    ]),
  ),
  [expectedGap[0], expectedGap[2]],
);

for (const recurrence of [
  "FREQ=DAILY;TZID=Europe/Prague",
  "FREQ=DAILY;BYEASTER=0",
  "FREQ=DAILY;BYSECOND=60",
  "FREQ=DAILY;BYMONTH=13",
  "FREQ=DAILY;BYDAY=0MO",
  "FREQ=DAILY;INTERVAL=1.5",
])
  assert.throws(
    () => expand([{ ...gapSeries, recurrence }]),
    EventExpansionError,
  );
assert.throws(
  () => expand([{ ...gapSeries, timeModel: null }, moved]),
  /legacy-exception-parent-unresolved/,
);
// Occurrence endpoints must remain coherent when consumed as a standalone event.
for (const series of [gapSeries, floating]) {
  const occurrences = expand([series]);
  for (const occurrence of occurrences) {
    const standalone = expand([{ ...occurrence, recurrence: null }]);
    assert.equal(standalone[0].start.getTime(), occurrence.start.getTime());
    assert.equal(standalone[0].end.getTime(), occurrence.end.getTime());
  }
}
const lastWeekday = zoned(
  "2026-01-30T09:00:00.000",
  "2026-01-30T10:00:00.000",
  "UTC",
  "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3",
);
assert.deepEqual(starts(expand([lastWeekday], "2026-01-01Z", "2026-04-01Z")), [
  "2026-01-30T09:00:00.000Z",
  "2026-02-27T09:00:00.000Z",
  "2026-03-31T09:00:00.000Z",
]);
for (const [zone, startLocal, endLocal, from, to, expected] of [
  [
    "America/New_York",
    "2026-03-07T02:30:00.000",
    "2026-03-07T03:30:00.000",
    "2026-03-07Z",
    "2026-03-12Z",
    [
      "2026-03-07T07:30:00.000Z",
      "2026-03-09T06:30:00.000Z",
      "2026-03-10T06:30:00.000Z",
    ],
  ],
  [
    "Australia/Lord_Howe",
    "2026-10-03T02:15:00.000",
    "2026-10-03T03:15:00.000",
    "2026-10-02Z",
    "2026-10-07Z",
    [
      "2026-10-02T15:45:00.000Z",
      "2026-10-04T15:15:00.000Z",
      "2026-10-05T15:15:00.000Z",
    ],
  ],
] as const)
  assert.deepEqual(
    starts(expand([zoned(startLocal, endLocal, zone)], from, to)),
    expected,
  );
for (const recurrence of [
  "FREQ=DAILY;BYDAY=1SA",
  "FREQ=WEEKLY;BYMONTHDAY=28",
  "FREQ=MONTHLY;BYWEEKNO=1",
  "FREQ=DAILY;BYSETPOS=1",
  "FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30",
])
  assert.throws(
    () => expand([{ ...gapSeries, recurrence }]),
    EventExpansionError,
  );
assert.throws(
  () => expand([{ ...day, recurrence: "FREQ=DAILY;BYHOUR=0,12;COUNT=3" }]),
  /invalid-recurrence-combination/,
);
const dense = `FREQ=DAILY;BYHOUR=${Array.from({ length: 24 }, (_, i) => i).join(",")};BYMINUTE=${Array.from({ length: 60 }, (_, i) => i).join(",")};BYSECOND=${Array.from({ length: 60 }, (_, i) => i).join(",")}`;
assert.throws(
  () =>
    expand([
      zoned("2026-01-01T00:00:00.000", "2026-01-01T01:00:00.000", "UTC", dense),
    ]),
  /recurrence-density-exceeded/,
);
assert.throws(
  () => expand([{ ...gapSeries, recurrence: "FREQ=DAILY;BYHOUR=2,02" }]),
  /duplicate-recurrence-field-value/,
);
assert.throws(
  () =>
    expand([
      zoned(
        "1800-01-01T09:00:00.000",
        "1800-01-01T10:00:00.000",
        "UTC",
        "FREQ=DAILY",
      ),
    ]),
  /recurrence-budget-exceeded/,
  "pre-window candidates count toward budget",
);
assert.deepEqual(
  expand(
    [
      zoned(
        "2024-01-01T00:00:00.000",
        "2024-01-01T01:00:00.000",
        "UTC",
        `FREQ=DAILY;BYHOUR=${Array.from({ length: 24 }, (_, i) => i).join(",")};BYMINUTE=0,15,30,45;UNTIL=20240102T000000Z`,
      ),
    ],
    "2026-01-01Z",
    "2026-01-02Z",
  ),
  [],
  "UNTIL bounds pre-window work for expired series",
);
console.log(
  `Known time expansion through public API: OK (host TZ=${process.env.TZ ?? "default"})`,
);
