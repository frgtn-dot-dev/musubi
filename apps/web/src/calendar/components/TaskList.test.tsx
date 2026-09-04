import { describe, expect, it } from "vitest";
import {
  replaceTaskDate,
  replaceTaskTime,
  taskDateKey,
  taskTime,
} from "./TaskList";

describe("task editor date values", () => {
  it("keeps the local clock when changing a task date", () => {
    const original = new Date(2026, 0, 2, 14, 35, 20);
    const next = replaceTaskDate(original, "2026-02-03");

    expect(taskDateKey(next)).toBe("2026-02-03");
    expect(taskTime(next)).toBe("14:35");
    expect(next.getSeconds()).toBe(20);
  });

  it("replaces only the local time without serializing through UTC", () => {
    const original = new Date(2026, 0, 2, 14, 35, 20);
    const next = replaceTaskTime(original, "09:05");

    expect(taskDateKey(next)).toBe("2026-01-02");
    expect(taskTime(next)).toBe("09:05");
  });
});
