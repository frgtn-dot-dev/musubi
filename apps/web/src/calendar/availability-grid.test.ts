import { describe, expect, it } from "vitest";
import { availabilityDaySegments, currentAvailabilityResult, isAvailabilityGridDay } from "./availability-grid";
import { getDaySegments } from "@musubi/calendar/layout";
const interval = { sourceId: "source", label: "Work", start: "2026-07-26T21:30:00Z", end: "2026-07-27T01:00:00Z" };
describe("availability grid geometry", () => {
  it("clips UTC instants to normal local days without Event identities", () => {
    const [first] = availabilityDaySegments([interval], new Date(2026, 6, 26));
    const [second] = availabilityDaySegments([interval], new Date(2026, 6, 27));
    expect(first).toMatchObject({ startMin: 1410, endMin: 1440 }); expect(second).toMatchObject({ startMin: 0, endMin: 180 });
    expect(first).not.toHaveProperty("event"); expect(first).not.toHaveProperty("id");
  });
  it.each([new Date(2026, 2, 29), new Date(2026, 9, 25)])("projects blocks on clock-change days (%s)", day => {
    expect(isAvailabilityGridDay(day)).toBe(false);
    expect(availabilityDaySegments([{ ...interval, start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 1).toISOString(), end: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 4).toISOString() }], day)).toHaveLength(1);
  });
  it("pins existing event-axis DST limitation separately from the availability projection", () => {
    const day = new Date(2026, 2, 29);
    const [existing] = getDaySegments([{ id: "existing", title: "Existing", start: new Date(2026, 2, 29, 9), end: new Date(2026, 2, 29, 10), isAllDay: false }], day);
    expect(existing.startMin).toBe(480); // elapsed 08:00 slot, although civil time is 09:00
    expect(availabilityDaySegments([], day)).toEqual([]);
  });
  it("rejects range, identity and generation mismatches", () => {
    const source = { id: "source", generation: 2, enabled: true, label: "Work", accountLabel: "Google", reconnectRequired: false };
    const result = { start: interval.start, end: interval.end, observedAt: interval.start, sources: [{ sourceId: "source", generation: 2, status: "available" as const, intervals: [] }] };
    expect(currentAvailabilityResult(result, [source], interval.start, interval.end)).toBe(true);
    expect(currentAvailabilityResult(result, [{ ...source, generation: 3 }], interval.start, interval.end)).toBe(false);
    expect(currentAvailabilityResult({ ...result, sources: [...result.sources, ...result.sources] }, [source], interval.start, interval.end)).toBe(false);
    expect(currentAvailabilityResult(result, [source], interval.end, interval.end)).toBe(false);
  });
});
