import type { PageDocument } from "@musubi/types";
import { describe, expect, it } from "vitest";
import { upsertPageIntoList } from "./realtime";
import { reconnectDelay } from "./backoff";

function page(id: string, revision: number, name = id): PageDocument {
  return {
    config: {
      calendarVisibility: { hiddenCalendarIds: [], mode: "all" },
      filters: [],
      icon: "house" as const,
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

  it("re-sorts the list when a newer page position arrives", () => {
    const first = page("a", 1);
    const second = { ...page("b", 1), position: 1 };
    const moved = { ...second, position: 0, revision: 2 };
    const displaced = { ...first, position: 1, revision: 2 };

    const afterMove = upsertPageIntoList([first, second], moved);
    expect(afterMove.map((item) => item.id)).toEqual(["b", "a"]);
    expect(
      upsertPageIntoList(afterMove, displaced).map((item) => item.id),
    ).toEqual(["b", "a"]);
  });

  it("ignores an equal or older revision (echo of our own change)", () => {
    const list = [page("a", 3, "current")];
    expect(upsertPageIntoList(list, page("a", 3, "echo"))).toBe(list);
    expect(upsertPageIntoList(list, page("a", 2, "stale"))).toBe(list);
  });
});

describe("reconnectDelay", () => {
  it("backs off exponentially", () => {
    const jitter = () => 1;
    expect(reconnectDelay(1, { jitter })).toBe(1_000);
    expect(reconnectDelay(2, { jitter })).toBe(2_000);
    expect(reconnectDelay(3, { jitter })).toBe(4_000);
  });

  it("stops growing at the ceiling", () => {
    const jitter = () => 1;
    expect(reconnectDelay(20, { jitter })).toBe(30_000);
  });

  it("spreads a herd rather than releasing it in lockstep", () => {
    // Half the window plus jitter: two tabs that dropped together come back at
    // different moments instead of hitting a recovering server at once.
    expect(reconnectDelay(3, { jitter: () => 0 })).toBe(2_000);
    expect(reconnectDelay(3, { jitter: () => 0.5 })).toBe(3_000);
    expect(reconnectDelay(3, { jitter: () => 1 })).toBe(4_000);
  });

  it("never waits no time at all", () => {
    expect(reconnectDelay(1, { jitter: () => 0 })).toBeGreaterThan(0);
    // An attempt counter that never advanced still waits.
    expect(reconnectDelay(0, { jitter: () => 0 })).toBeGreaterThan(0);
  });
});
