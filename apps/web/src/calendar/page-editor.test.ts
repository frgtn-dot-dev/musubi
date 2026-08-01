import type { PageDocument } from "@musubi/types";
import { describe, expect, it } from "vitest";
import { markDefaultPage } from "./page-editor";

function page(id: string, isDefault: boolean): PageDocument {
  return {
    config: {
      calendarVisibility: { hiddenCalendarIds: [], mode: "all" },
      filters: [],
      schemaVersion: 1,
      view: { configVersion: 1, id: "month", showAdjacentDays: true },
    },
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    id,
    isDefault,
    name: id,
    position: isDefault ? 0 : 1,
    revision: 1,
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  };
}

describe("markDefaultPage", () => {
  it("moves the default flag without changing order or documents in place", () => {
    const original = [page("home", true), page("work", false)];
    const result = markDefaultPage(original, "work");

    expect(result.map(({ id, isDefault }) => ({ id, isDefault }))).toEqual([
      { id: "home", isDefault: false },
      { id: "work", isDefault: true },
    ]);
    expect(original[0]!.isDefault).toBe(true);
    expect(result.map((item) => item.id)).toEqual(["home", "work"]);
  });
});
