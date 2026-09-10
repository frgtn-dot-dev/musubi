import { describe, expect, it } from "vitest";
import { buildDayAxis, civilCandidates, instantToCoordinate, sharedWeekAxis, singleDayAxis } from "./day-axis";
import { createTimeGeometry } from "./time-geometry";
import { nextAxisDragTimes, type DragMode } from "./time-grid-drag";

const spring = sharedWeekAxis([buildDayAxis("2026-03-28", "Europe/Prague"), buildDayAxis("2026-03-29", "Europe/Prague")]);
const fall = singleDayAxis(buildDayAxis("2026-10-25", "Europe/Prague"));
const geometry = createTimeGeometry();
function drag(axis: typeof spring, column: number, start: string, end: string, deltaMinutes: number, mode: DragMode = "move", target = column) {
  const exactRange = { start: new Date(start), end: new Date(end) };
  return nextAxisDragTimes({ axis, geometry, dayIndex: target, originDayIndex: column, deltaMinutes, mode, exactRange,
    originStartMinutes: instantToCoordinate(axis, column, exactRange.start.getTime())!,
    originEndMinutes: exactRange.end.getTime() >= axis.days[column]!.end ? axis.rows.length : instantToCoordinate(axis, column, exactRange.end.getTime())!,
  });
}
describe("axis gestures preserve real instants", () => {
  it("moves first Prague 02:30 to second 02:30 with its real duration", () => {
    const result = drag(fall, 0, "2026-10-25T00:30:00Z", "2026-10-25T00:45:00Z", 60)!;
    expect(result.exactRange).toEqual({ start: new Date("2026-10-25T01:30:00Z"), end: new Date("2026-10-25T01:45:00Z") });
    expect(result.startMinutes).toBe(210);
  });
  it("refuses a spring hole instead of normalizing to 03:30", () => {
    expect(drag(spring, 0, "2026-03-28T01:30:00Z", "2026-03-28T02:00:00Z", 0, "move", 1)).toBeNull();
  });
  it("crosses a spring hole while preserving elapsed duration", () => {
    const result = drag(spring, 1, "2026-03-29T00:30:00Z", "2026-03-29T01:30:00Z", 0)!;
    expect(result.endMinutes - result.startMinutes).toBe(120);
    expect(result.exactRange!.end.getTime() - result.exactRange!.start.getTime()).toBe(3_600_000);
  });
  it("resize reaches day end without wrapping to the first midnight", () => {
    const result = drag(fall, 0, "2026-10-25T21:30:00Z", "2026-10-25T22:00:00Z", 60, "resize-end")!;
    expect(result.exactRange!.end.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(result.endMinutes).toBe(1500);
  });
  it("resizes through both folds using the fixed opposite instant", () => {
    const result = drag(fall, 0, "2026-10-25T00:30:00Z", "2026-10-25T00:45:00Z", 60, "resize-end")!;
    expect(result.exactRange!.start.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(result.exactRange!.end.toISOString()).toBe("2026-10-25T01:45:00.000Z");
  });
  it("preserves complete cross-midnight ranges", () => {
    const result = drag(fall, 0, "2026-10-25T22:00:00Z", "2026-10-26T00:00:00Z", -15)!;
    expect(result.exactRange!.start.toISOString()).toBe("2026-10-25T21:45:00.000Z");
    expect(result.exactRange!.end.toISOString()).toBe("2026-10-25T23:45:00.000Z");
  });
  it("moves a zero-duration imported event without inventing duration", () => {
    const result = drag(fall, 0, "2026-10-25T00:30:00Z", "2026-10-25T00:30:00Z", 60)!;
    expect(result.exactRange).toEqual({ start: new Date("2026-10-25T01:30:00Z"), end: new Date("2026-10-25T01:30:00Z") });
  });
  it("keeps short resize endpoints inside their real day boundaries", () => {
    const axis = singleDayAxis(buildDayAxis("2026-07-26", "Europe/Prague"));
    expect(drag(axis, 0, "2026-07-26T21:50:00Z", "2026-07-26T21:55:00Z", 15, "resize-end")!.exactRange!.end.toISOString()).toBe("2026-07-26T22:00:00.000Z");
    expect(drag(axis, 0, "2026-07-25T22:00:00Z", "2026-07-25T22:05:00Z", 15, "resize-start")!.exactRange!.start.toISOString()).toBe("2026-07-25T22:00:00.000Z");
    const marker = drag(axis, 0, "2026-07-25T22:15:00Z", "2026-07-25T22:15:00Z", -15)!;
    expect(marker.startMinutes).toBe(0); expect(marker.endMinutes).toBe(0);
    expect(marker.exactRange!.start.getTime()).toBe(marker.exactRange!.end.getTime());
  });
  it("clamps a short event forward to midnight without moving backwards", () => {
    const axis = singleDayAxis(buildDayAxis("2026-07-26", "Europe/Prague"));
    const result = drag(axis, 0, "2026-07-26T21:50:00Z", "2026-07-26T21:55:00Z", 15)!;
    expect(result.exactRange).toEqual({ start: new Date("2026-07-26T21:55:00Z"), end: new Date("2026-07-26T22:00:00Z") });
  });
  it("distinguishes the Lord Howe half-hour folds", () => {
    const axis = singleDayAxis(buildDayAxis("2026-04-05", "Australia/Lord_Howe"));
    const [first, second] = civilCandidates(axis.days[0]!, 105);
    const result = drag(axis, 0, new Date(first!.instant).toISOString(), new Date(first!.instant + 600_000).toISOString(), 30)!;
    expect(result.exactRange!.start.getTime()).toBe(second!.instant);
  });
});
