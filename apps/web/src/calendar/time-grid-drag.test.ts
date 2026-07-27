import { describe, expect, it } from "vitest";
import { createTimeGeometry } from "./time-geometry";
import {
  autoScrollStep,
  dayIndexFromX,
  exceedsDragThreshold,
  nextDragTimes,
} from "./time-grid-drag";

const geometry = createTimeGeometry("comfortable"); // 64px/h, snap 15

function times(
  mode: "move" | "resize-start" | "resize-end",
  deltaMinutes: number,
  origin = { end: 11 * 60, start: 10 * 60 },
) {
  return nextDragTimes({
    deltaMinutes,
    geometry,
    mode,
    originEndMinutes: origin.end,
    originStartMinutes: origin.start,
  });
}

describe("nextDragTimes — move", () => {
  it("keeps the duration and snaps to the lattice", () => {
    expect(times("move", 20)).toEqual({
      endMinutes: 11 * 60 + 15,
      startMinutes: 10 * 60 + 15,
    });
  });

  it("tidies an event that started off the lattice", () => {
    // 10:07 dragged by 15 lands on the grid rather than staying at :07.
    const result = times("move", 15, { end: 11 * 60 + 7, start: 10 * 60 + 7 });
    expect(result.startMinutes % geometry.snapMinutes).toBe(0);
    expect(result.endMinutes - result.startMinutes).toBe(60);
  });

  it("stops at the end of the day without shrinking", () => {
    const result = times("move", 10_000);
    expect(result.endMinutes).toBe(24 * 60);
    expect(result.endMinutes - result.startMinutes).toBe(60);
  });

  it("stops at the start of the day without shrinking", () => {
    const result = times("move", -10_000);
    expect(result.startMinutes).toBe(0);
    expect(result.endMinutes - result.startMinutes).toBe(60);
  });
});

describe("nextDragTimes — resize", () => {
  it("moves only the dragged edge", () => {
    expect(times("resize-start", -30)).toEqual({
      endMinutes: 11 * 60,
      startMinutes: 9 * 60 + 30,
    });
    expect(times("resize-end", 30)).toEqual({
      endMinutes: 11 * 60 + 30,
      startMinutes: 10 * 60,
    });
  });

  it("never inverts the event — one interval always remains", () => {
    // Dragging the start past the end, and the end past the start.
    expect(times("resize-start", 600).startMinutes).toBe(
      11 * 60 - geometry.snapMinutes,
    );
    expect(times("resize-end", -600).endMinutes).toBe(
      10 * 60 + geometry.snapMinutes,
    );
  });

  it("clamps to the day edges", () => {
    expect(times("resize-start", -10_000).startMinutes).toBe(0);
    expect(times("resize-end", 10_000).endMinutes).toBe(24 * 60);
  });
});

describe("dayIndexFromX", () => {
  it("maps a pointer to its column", () => {
    expect(dayIndexFromX(150, 100, 100, 7)).toBe(0);
    expect(dayIndexFromX(250, 100, 100, 7)).toBe(1);
  });

  it("clamps outside the grid", () => {
    expect(dayIndexFromX(-500, 100, 100, 7)).toBe(0);
    expect(dayIndexFromX(9999, 100, 100, 7)).toBe(6);
    expect(dayIndexFromX(150, 100, 100, 1)).toBe(0);
  });

  it("survives a zero-width column", () => {
    expect(dayIndexFromX(150, 100, 0, 7)).toBe(0);
  });
});

describe("autoScrollStep", () => {
  const viewport = { bottom: 800, top: 100 };

  it("is still inside the comfortable zone", () => {
    expect(autoScrollStep(400, viewport)).toBe(0);
  });

  it("scrolls up near the top and down near the bottom", () => {
    expect(autoScrollStep(110, viewport)).toBeLessThan(0);
    expect(autoScrollStep(790, viewport)).toBeGreaterThan(0);
  });

  it("ramps up towards the edge", () => {
    const near = Math.abs(autoScrollStep(102, viewport));
    const further = Math.abs(autoScrollStep(140, viewport));
    expect(near).toBeGreaterThan(further);
  });
});

describe("exceedsDragThreshold", () => {
  it("treats a small wobble as a click", () => {
    expect(exceedsDragThreshold({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(false);
  });

  it("becomes a drag once the pointer travels", () => {
    expect(exceedsDragThreshold({ x: 10, y: 10 }, { x: 10, y: 20 })).toBe(true);
    expect(exceedsDragThreshold({ x: 10, y: 10 }, { x: 20, y: 10 })).toBe(true);
  });
});
