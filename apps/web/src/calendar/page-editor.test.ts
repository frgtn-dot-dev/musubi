import type { PageDocument } from "@musubi/types";
import { describe, expect, it } from "vitest";
import {
  markDefaultPage,
  pageConfigEquals,
  viewConfigFor,
} from "./page-editor";

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

describe("Page draft helpers", () => {
  it("compares visibility ids without making their order significant", () => {
    const left = page("home", true).config;
    const right = {
      ...left,
      calendarVisibility: {
        hiddenCalendarIds: ["studio", "work"],
        mode: "all" as const,
      },
    };
    const reordered = {
      ...right,
      calendarVisibility: {
        hiddenCalendarIds: ["work", "studio"],
        mode: "all" as const,
      },
    };

    expect(pageConfigEquals(right, reordered)).toBe(true);
    expect(pageConfigEquals(left, right)).toBe(false);
  });

  it("treats an omitted poll layer as hidden", () => {
    const legacy = page("home", true).config;
    expect(pageConfigEquals(legacy, { ...legacy, showPolls: false })).toBe(true);
    expect(pageConfigEquals(legacy, { ...legacy, showPolls: true })).toBe(false);
  });

  it("keeps same-view options and uses defaults for a different view", () => {
    const config = page("home", true).config;

    expect(viewConfigFor(config, "month")).toBe(config.view);
    expect(viewConfigFor(config, "week")).toEqual({
      configVersion: 1,
      density: "comfortable",
      id: "week",
      weekend: true,
    });
  });
});

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
