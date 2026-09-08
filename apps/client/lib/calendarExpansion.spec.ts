import { expect, it } from "vitest";
import { expandCalendarView, CALENDAR_EXPANSION_ERROR } from "./calendarExpansion";

const start = new Date("2026-01-01T00:00:00Z");
const end = new Date("2026-01-05T00:00:00Z");
const master = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Private meeting",
  isCanceled: false,
  start: new Date("2026-01-02T09:00:00Z"),
  end: new Date("2026-01-02T10:00:00Z"),
  recurrence: "FREQ=DAILY;COUNT=2",
  timeModel: { kind: "zoned" as const, timeZone: "UTC", startLocal: "2026-01-02T09:00:00.000", endLocal: "2026-01-02T10:00:00.000" },
};

it("reports a failed complete view without leaking parser data, then recovers", () => {
  const invalid = { ...master, recurrence: "FREQ=HOURLY" };
  const definitions = [invalid, { ...master, id: "00000000-0000-4000-8000-000000000003", recurrence: null }];
  const before = structuredClone(definitions);
  const result = expandCalendarView(definitions, start, end, { consumerTimeZone: "UTC" });
  expect(result).toEqual({ events: [], error: CALENDAR_EXPANSION_ERROR });
  expect(result.error).not.toContain(master.title);
  expect(result.error).not.toContain("HOURLY");
  expect(definitions).toEqual(before);
  const recovered = expandCalendarView([master], start, end, { consumerTimeZone: "UTC" });
  expect(recovered.error).toBeNull();
  expect(recovered.events.map(event => event.start.toISOString())).toEqual(["2026-01-02T09:00:00.000Z", "2026-01-03T09:00:00.000Z"]);
});

it("preserves cancelled replacements and distant agenda events", () => {
  const cancelled = {
    ...master,
    id: "00000000-0000-4000-8000-000000000002",
    seriesID: master.id,
    originalStart: { kind: "instant" as const, value: "2026-01-02T09:00:00.000Z" },
    recurrence: null,
    isCanceled: true,
  };
  const distant = { ...master, id: "00000000-0000-4000-8000-000000000003", start: new Date("2030-01-01T09:00:00Z"), end: new Date("2030-01-01T10:00:00Z"), recurrence: null, timeModel: null };
  const result = expandCalendarView([master, cancelled, distant], start, end, { consumerTimeZone: "UTC", includeAllNonRecurring: true });
  expect(result.error).toBeNull();
  expect(result.events.filter(event => !event.isCanceled).map(event => event.start.toISOString())).toEqual(["2026-01-03T09:00:00.000Z", "2030-01-01T09:00:00.000Z"]);
});
