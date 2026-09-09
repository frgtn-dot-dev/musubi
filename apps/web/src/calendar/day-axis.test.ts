import { describe, expect, it } from "vitest";
import { buildDayAxis, civilCandidates, coordinateBoundaryInstant, coordinateToInstant, instantToCoordinate, intervalAxisSegments, sharedWeekAxis, singleDayAxis } from "./day-axis";
const cases = [
  ["2026-07-26", "Europe/Prague", 1440],
  ["2026-03-29", "Europe/Prague", 1380],
  ["2026-10-25", "Europe/Prague", 1500],
  ["2026-10-04", "Australia/Lord_Howe", 1410],
  ["2026-04-05", "Australia/Lord_Howe", 1470],
] as const;
describe("civil day axis", () => {
  it.each(cases)("roundtrips every real minute and fractional coordinate of %s in %s", (date, zone, length) => {
    const day = buildDayAxis(date, zone), axis = singleDayAxis(day);
    expect(axis.rows).toHaveLength(length); expect(day.end - day.start).toBe(length * 60000);
    for (let coordinate = 0; coordinate < length; coordinate++) {
      const instant = coordinateToInstant(axis, 0, coordinate + 0.25)!;
      expect(instant).toBe(day.start + (coordinate + 0.25) * 60000);
      expect(instantToCoordinate(axis, 0, instant)).toBe(coordinate + 0.25);
    }
    expect(coordinateBoundaryInstant(axis, 0, length, "end")).toBe(day.end);
    expect(coordinateBoundaryInstant(axis, 0, length, "start")).toBeNull();
    expect(coordinateToInstant(axis, 0, length - 0.0000001)).toBe(day.end - 1);
    expect(coordinateToInstant(axis, 0, length)).toBeNull(); expect(coordinateToInstant(axis, 0, -0.01)).toBeNull();
    expect(instantToCoordinate(axis, 0, day.end)).toBeNull();
  });
  it("does not normalize gaps and retains both UTC identities in a fold", () => {
    const spring = buildDayAxis("2026-03-29", "Europe/Prague");
    expect(civilCandidates(spring, 150)).toEqual([]);
    const fall = buildDayAxis("2026-10-25", "Europe/Prague");
    expect(civilCandidates(fall, 150).map(value => [new Date(value.instant).toISOString(), value.fold, value.offsetMinutes])).toEqual([
      ["2026-10-25T00:30:00.000Z", 0, 120], ["2026-10-25T01:30:00.000Z", 1, 60],
    ]);
  });
  it("clips cross-midnight intervals to actual local day boundaries", () => {
    const day = buildDayAxis("2026-10-25", "Europe/Prague"), axis = singleDayAxis(day);
    expect(intervalAxisSegments(axis, 0, day.start - 3600000, day.start + 1800000)).toEqual([{ start: 0, end: 30 }]);
    expect(intervalAxisSegments(axis, 0, day.end - 1800000, day.end + 3600000)).toEqual([{ start: 1470, end: 1500 }]);
    expect(intervalAxisSegments(axis, 0, day.end, day.end + 3600000)).toEqual([]);
  });
  it("refuses malformed, normalized, skipped dates and invalid zones", () => {
    expect(() => buildDayAxis("2026-02-30", "Europe/Prague")).toThrow();
    expect(() => buildDayAxis("2011-12-30", "Pacific/Apia")).toThrow(/does not exist/);
    expect(() => buildDayAxis("2026-01-01", "invalid")).toThrow();
  });
});
describe("shared week union", () => {
  it.each([
    ["2026-03-28", "2026-03-29", "Europe/Prague", 1440, 60],
    ["2026-10-24", "2026-10-25", "Europe/Prague", 1500, 60],
    ["2026-10-03", "2026-10-04", "Australia/Lord_Howe", 1440, 30],
    ["2026-04-04", "2026-04-05", "Australia/Lord_Howe", 1470, 30],
  ] as const)("aligns %s and %s, retaining chronological rows and noninteractive holes", (normal, transition, zone, length, missing) => {
    const days = [buildDayAxis(normal, zone), buildDayAxis(transition, zone)], axis = sharedWeekAxis(days);
    expect(axis.rows).toHaveLength(length);
    expect(axis.columns.flat().filter(value => value === null)).toHaveLength(missing);
    for (let column = 0; column < 2; column++) {
      expect(axis.columns[column]!.filter(Boolean)).toEqual(days[column]!.minutes);
      for (let row = 0; row < length; row++) {
        const value = axis.columns[column]![row];
        if (value) expect(instantToCoordinate(axis, column, coordinateToInstant(axis, column, row + 0.5)!)).toBe(row + 0.5);
        else expect(coordinateToInstant(axis, column, row + 0.5)).toBeNull();
      }
      const all = intervalAxisSegments(axis, column, days[column]!.start, days[column]!.end);
      expect(all.reduce((sum, segment) => sum + segment.end - segment.start, 0)).toBe(days[column]!.minutes.length);
    }
    const nine = days.map(day => civilCandidates(day, 540)[0]!.instant);
    expect(instantToCoordinate(axis, 0, nine[0]!)).toBe(instantToCoordinate(axis, 1, nine[1]!));
  });
  it("preserves a full repeated block and splits ordinary-day intervals around its hole", () => {
    const normal = buildDayAxis("2026-10-24", "Europe/Prague"), fall = buildDayAxis("2026-10-25", "Europe/Prague"), axis = sharedWeekAxis([normal, fall]);
    expect(axis.rows.slice(178, 183).map(value => value.key)).toEqual(["178/0", "179/0", "120/1", "121/1", "122/1"]);
    expect(intervalAxisSegments(axis, 0, civilCandidates(normal, 150)[0]!.instant, civilCandidates(normal, 210)[0]!.instant)).toEqual([{ start: 150, end: 180 }, { start: 240, end: 270 }]);
    expect(coordinateBoundaryInstant(axis, 0, 180, "end")).toBe(civilCandidates(normal, 180)[0]!.instant);
    expect(coordinateBoundaryInstant(axis, 0, 180, "start")).toBeNull();
    expect(coordinateBoundaryInstant(axis, 0, 240, "end")).toBeNull();
    expect(coordinateBoundaryInstant(axis, 0, 240, "start")).toBe(civilCandidates(normal, 180)[0]!.instant);
    expect(() => sharedWeekAxis([normal, normal])).toThrow();
  });
});
it("roundtrips millisecond instants at the epoch and on both sides of a fold", () => {
  for (const [date, zone, instants] of [
    ["1970-01-01", "UTC", [1, 29, 59, 1234567, 86399999]],
    ["2026-10-25", "Europe/Prague", [Date.parse("2026-10-25T00:30:00.123Z"), Date.parse("2026-10-25T01:30:00.987Z")]],
  ] as const) {
    const axis = singleDayAxis(buildDayAxis(date, zone));
    for (const instant of instants) expect(coordinateToInstant(axis, 0, instantToCoordinate(axis, 0, instant)!)).toBe(instant);
  }
});
it("preserves fractional endpoints around a shared-week hole", () => {
  const normal = buildDayAxis("2026-10-24", "Europe/Prague"), fall = buildDayAxis("2026-10-25", "Europe/Prague"), axis = sharedWeekAxis([normal, fall]);
  const start = civilCandidates(normal, 179)[0]!.instant + 123, end = civilCandidates(normal, 180)[0]!.instant + 45678;
  const segments = intervalAxisSegments(axis, 0, start, end);
  expect(segments).toHaveLength(2);
  expect(segments[0]!.end).toBe(180); expect(segments[1]!.start).toBe(240);
  expect(coordinateBoundaryInstant(axis, 0, segments[0]!.start, "start")).toBe(start);
  expect(coordinateBoundaryInstant(axis, 0, segments[1]!.end, "end")).toBe(end);
  expect(segments.reduce((sum, segment) => sum + (segment.end - segment.start) * 60000, 0)).toBeCloseTo(end - start, 5);
});
