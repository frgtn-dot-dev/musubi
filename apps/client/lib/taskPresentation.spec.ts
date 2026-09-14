import { expect, it } from "vitest";
import { formatTaskDate } from "./taskPresentation";
import { formatDateMedium, formatTime } from "./datetimeFormat";

it("preserves an all-day task civil date regardless of the device zone", () => {
  expect(formatTaskDate(new Date("2026-09-15T00:00:00Z"), true, "ymd", "24h"))
    .toBe(formatDateMedium(new Date(2026, 8, 15, 12), "ymd"));
});

it("keeps timed task and completion timestamps as local instants", () => {
  const instant = new Date("2026-09-15T00:00:00Z");
  expect(formatTaskDate(instant, false, "ymd", "24h"))
    .toBe(`${formatDateMedium(instant, "ymd")}, ${formatTime(instant, "24h")}`);
});
