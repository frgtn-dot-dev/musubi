import { describe, expect, it } from "vitest";
import { clampOffset } from "./window-drag";

const bounds = { height: 600, left: 200, top: 100, width: 1000 };
const base = { height: 300, left: 400, top: 200, width: 340 };

describe("clampOffset", () => {
  it("passes through a move that keeps the box inside", () => {
    expect(clampOffset({ base, bounds, offset: { x: 60, y: -40 } })).toEqual({
      x: 60,
      y: -40,
    });
  });

  it("stops the box at each edge instead of the pointer", () => {
    // Far left: the box's left edge lands on the bounds' left edge.
    expect(clampOffset({ base, bounds, offset: { x: -9_000, y: 0 } }).x).toBe(
      -200,
    );
    // Far right: its right edge lands on the bounds' right edge.
    expect(clampOffset({ base, bounds, offset: { x: 9_000, y: 0 } }).x).toBe(
      460,
    );
    expect(clampOffset({ base, bounds, offset: { x: 0, y: -9_000 } }).y).toBe(
      -100,
    );
    expect(clampOffset({ base, bounds, offset: { x: 0, y: 9_000 } }).y).toBe(
      200,
    );
  });

  it("pins a box bigger than its bounds to the top-left edge", () => {
    const tall = { height: 900, left: 400, top: 200, width: 340 };

    const offset = clampOffset({
      base: tall,
      bounds,
      offset: { x: 0, y: 500 },
    });

    // Only one edge can be satisfied; the near one wins, so the header stays
    // reachable rather than the box floating past the bottom.
    expect(offset.y).toBe(-100);
  });
});
