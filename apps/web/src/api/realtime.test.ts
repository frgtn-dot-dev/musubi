import type { PageDocument } from "@musubi/types";
import { describe, expect, it } from "vitest";
import { upsertPageIntoList } from "./realtime";

function page(id: string, revision: number, name = id): PageDocument {
  return {
    config: {
      calendarVisibility: { hiddenCalendarIds: [], mode: "all" },
      filters: [],
      schemaVersion: 1,
      view: { configVersion: 1, id: "month", showAdjacentDays: true },
    },
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    id,
    isDefault: false,
    name,
    position: 0,
    revision,
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  };
}

describe("upsertPageIntoList", () => {
  it("adds a page that is not present yet", () => {
    const result = upsertPageIntoList([page("a", 1)], page("b", 1));
    expect(result.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("replaces a page with a strictly newer revision", () => {
    const result = upsertPageIntoList(
      [page("a", 1, "old")],
      page("a", 2, "new"),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("new");
  });

  it("ignores an equal or older revision (echo of our own change)", () => {
    const list = [page("a", 3, "current")];
    expect(upsertPageIntoList(list, page("a", 3, "echo"))).toBe(list);
    expect(upsertPageIntoList(list, page("a", 2, "stale"))).toBe(list);
  });
});
