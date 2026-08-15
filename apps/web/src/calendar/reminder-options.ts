import type { ReminderRule } from "@musubi/types";

/**
 * The handful of reminder choices a segmented control can hold.
 *
 * Two rows, because a timed event and an all-day event ask different questions:
 * "how long before" makes no sense for a birthday, and "which morning" makes
 * none for a 3pm meeting.
 *
 * The phone offers a longer list (15 minutes, half a day). A rule set there
 * must survive being LOOKED at here — hence `CUSTOM`, which shows what is
 * stored and is only ever replaced by a deliberate click.
 */

export const CUSTOM = "custom";

export const TIMED_OPTIONS = [
  { label: "Off", value: "off" },
  { label: "10 min", value: "10" },
  { label: "30 min", value: "30" },
  { label: "1 hour", value: "60" },
  { label: "1 day", value: "1440" },
] as const;

export const ALL_DAY_OPTIONS = [
  { label: "Off", value: "off" },
  { label: "That morning", value: "morning" },
  { label: "Evening before", value: "evening" },
] as const;

const MORNING = { atMinute: 9 * 60, daysBefore: 0 };
const EVENING = { atMinute: 18 * 60, daysBefore: 1 };

export function timedValue(rule: ReminderRule): string {
  if (rule.minutesBefore === null) return "off";
  const minutes = String(rule.minutesBefore);
  return TIMED_OPTIONS.some((option) => option.value === minutes)
    ? minutes
    : CUSTOM;
}

export function allDayValue(rule: ReminderRule): string {
  if (rule.allDay === null) return "off";
  if (rule.allDay.daysBefore === MORNING.daysBefore && rule.allDay.atMinute === MORNING.atMinute) {
    return "morning";
  }
  if (rule.allDay.daysBefore === EVENING.daysBefore && rule.allDay.atMinute === EVENING.atMinute) {
    return "evening";
  }
  return CUSTOM;
}

export function withTimed(rule: ReminderRule, value: string): ReminderRule {
  if (value === CUSTOM) return rule;
  return {
    ...rule,
    minutesBefore: value === "off" ? null : Number(value),
  };
}

export function withAllDay(rule: ReminderRule, value: string): ReminderRule {
  if (value === CUSTOM) return rule;
  if (value === "off") return { ...rule, allDay: null };
  return { ...rule, allDay: value === "morning" ? { ...MORNING } : { ...EVENING } };
}

/** What the stored rule says, for a control that has no button for it. */
export function customLabel(rule: ReminderRule, kind: "allDay" | "timed") {
  if (kind === "timed") {
    const minutes = rule.minutesBefore ?? 0;
    return minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
  }
  const allDay = rule.allDay;
  if (!allDay) return "Off";
  const hour = String(Math.floor(allDay.atMinute / 60)).padStart(2, "0");
  const minute = String(allDay.atMinute % 60).padStart(2, "0");
  return allDay.daysBefore === 0
    ? `${hour}:${minute}`
    : `${allDay.daysBefore} d before, ${hour}:${minute}`;
}

/** Options plus a slot for whatever the rule actually holds, when it is odd. */
export function optionsFor(rule: ReminderRule, kind: "allDay" | "timed") {
  const base = kind === "timed" ? TIMED_OPTIONS : ALL_DAY_OPTIONS;
  const value = kind === "timed" ? timedValue(rule) : allDayValue(rule);
  return value === CUSTOM
    ? [...base, { label: customLabel(rule, kind), value: CUSTOM }]
    : [...base];
}
