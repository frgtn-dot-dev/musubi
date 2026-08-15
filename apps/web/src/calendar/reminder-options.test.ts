import { describe, expect, it } from "vitest";
import type { ReminderRule } from "@musubi/types";
import {
  allDayValue,
  CUSTOM,
  optionsFor,
  timedValue,
  withAllDay,
  withTimed,
} from "./reminder-options";

const rule = (over: Partial<ReminderRule> = {}): ReminderRule => ({
  allDay: { atMinute: 18 * 60, daysBefore: 1 },
  minutesBefore: 10,
  ...over,
});

describe("reminder options", () => {
  it("reads a rule the control has a button for", () => {
    expect(timedValue(rule())).toBe("10");
    expect(allDayValue(rule())).toBe("evening");
    expect(allDayValue(rule({ allDay: { atMinute: 540, daysBefore: 0 } }))).toBe(
      "morning",
    );
  });

  it("says off rather than picking something", () => {
    expect(timedValue(rule({ minutesBefore: null }))).toBe("off");
    expect(allDayValue(rule({ allDay: null }))).toBe("off");
  });

  it("shows a rule set on the phone instead of overwriting it", () => {
    // The mobile app offers 15 minutes; this control does not. Rendering that
    // as "10 min" would be a lie, and worse, saving the row would make it true.
    const fromPhone = rule({ minutesBefore: 15 });
    expect(timedValue(fromPhone)).toBe(CUSTOM);
    expect(optionsFor(fromPhone, "timed").at(-1)).toEqual({
      label: "15 min",
      value: CUSTOM,
    });
    expect(withTimed(fromPhone, CUSTOM)).toEqual(fromPhone);
  });

  it("changes one branch without disturbing the other", () => {
    expect(withTimed(rule(), "60")).toEqual(rule({ minutesBefore: 60 }));
    expect(withAllDay(rule(), "off")).toEqual(rule({ allDay: null }));
    expect(withTimed(rule(), "off").allDay).toEqual(rule().allDay);
  });
});
