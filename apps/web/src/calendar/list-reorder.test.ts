import { describe, expect, it } from "vitest";
import { dropIndexAt, moveItem, previewIndex } from "./list-reorder";

const rows = (count: number, height = 40) =>
  Array.from({ length: count }, (_, index) => ({
    height,
    top: index * height,
  }));

describe("list reorder", () => {
  it("moves an item without disturbing the rest", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("leaves the list alone for a move that goes nowhere", () => {
    const items = ["a", "b", "c"];
    expect(moveItem(items, 1, 1)).toBe(items);
    expect(moveItem(items, 5, 0)).toBe(items);
  });

  it("picks the slot whose half the pointer has crossed", () => {
    const boxes = rows(3);
    // Top half of the first row is still the first slot.
    expect(dropIndexAt(5, boxes)).toBe(0);
    // Past its middle the pointer belongs to the next one.
    expect(dropIndexAt(25, boxes)).toBe(1);
    expect(dropIndexAt(65, boxes)).toBe(2);
  });

  it("clamps above and below the list", () => {
    const boxes = rows(3);
    expect(dropIndexAt(-200, boxes)).toBe(0);
    expect(dropIndexAt(9_000, boxes)).toBe(2);
    expect(dropIndexAt(10, [])).toBe(0);
  });

  it("previews a downward move by pulling the rows in between up one", () => {
    // 0 → 2: the held row lands on 2, and 1 and 2 shuffle up to fill the gap.
    expect([0, 1, 2, 3].map((index) => previewIndex(index, 0, 2))).toEqual([
      2, 0, 1, 3,
    ]);
  });

  it("previews an upward move by pushing the rows in between down one", () => {
    expect([0, 1, 2, 3].map((index) => previewIndex(index, 3, 1))).toEqual([
      0, 2, 3, 1,
    ]);
  });

  it("agrees with the array move it previews", () => {
    const items = ["a", "b", "c", "d", "e"];
    for (const from of items.keys()) {
      for (const to of items.keys()) {
        const moved = moveItem(items, from, to);
        for (const [index, item] of items.entries()) {
          expect(moved[previewIndex(index, from, to)]).toBe(item);
        }
      }
    }
  });
});
