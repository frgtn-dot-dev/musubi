import { describe, expect, it } from "vitest";
import { queryKeys } from "./query-keys";

describe("queryKeys", () => {
  it("canonicalizes calendar order without losing user and range scope", () => {
    const base = {
      end: new Date("2026-08-10T00:00:00.000Z"),
      filterFingerprint: "all",
      serverOrigin: "https://musubi.example",
      start: new Date("2026-06-28T00:00:00.000Z"),
      userId: "user-1",
    };

    expect(
      queryKeys.eventRange({
        ...base,
        calendarIds: ["calendar-b", "calendar-a"],
      }),
    ).toEqual(
      queryKeys.eventRange({
        ...base,
        calendarIds: ["calendar-a", "calendar-b"],
      }),
    );
    expect(queryKeys.eventRange({ ...base, calendarIds: [] })).toContain(
      "user-1",
    );
  });
});
