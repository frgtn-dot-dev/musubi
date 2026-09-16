import { expect, it } from "vitest";
import { formatTaskDate, taskRepeatLabel } from "./taskPresentation";
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

it("describes weekly task recurrence using its civil start day and count", () => {
  expect(taskRepeatLabel({ recurrence: "FREQ=WEEKLY;COUNT=3", start: new Date("2026-09-15T00:00:00Z"), isAllDay: true }))
    .toBe("Every week on Tue, 3 times");
});
it("does not invent a weekday without a task date", () => {
  expect(taskRepeatLabel({ recurrence: "FREQ=WEEKLY", isAllDay: false })).toBe("Every week");
});
it("hides unsupported rules instead of showing raw or incomplete recurrence", () => {
  expect(taskRepeatLabel({ recurrence: "FREQ=MONTHLY;BYDAY=1MO", isAllDay: false })).toBeNull();
});
