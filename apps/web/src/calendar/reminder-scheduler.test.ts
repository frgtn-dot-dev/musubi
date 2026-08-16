import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedReminder } from "@musubi/calendar";
import { scheduleReminders } from "./reminder-scheduler";

function reminder(dueAt: string, id = "e1"): ResolvedReminder {
  return {
    dueAt: new Date(dueAt),
    eventID: id,
    isAllDay: false,
    occurrenceID: `${id}_1`,
    occurrenceStart: new Date(dueAt),
    title: "Standup",
  };
}

describe("scheduleReminders", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T09:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("fires when the reminder falls due", () => {
    const notify = vi.fn();
    scheduleReminders([reminder("2026-08-20T09:10:00Z")], notify);

    vi.advanceTimersByTime(9 * 60_000);
    expect(notify).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("chains a wait longer than setTimeout can hold", () => {
    // 40 days. A single setTimeout overflows its 32-bit delay here and fires
    // straight away — a reminder arriving a month early, which is the bug this
    // exists to prevent.
    const notify = vi.fn();
    scheduleReminders([reminder("2026-09-29T09:00:00Z")], notify);

    vi.advanceTimersByTime(30 * 24 * 3_600_000);
    expect(notify).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10 * 24 * 3_600_000);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("ignores a reminder that is already due", () => {
    const notify = vi.fn();
    scheduleReminders([reminder("2026-08-20T08:00:00Z")], notify);

    vi.advanceTimersByTime(24 * 3_600_000);
    expect(notify).not.toHaveBeenCalled();
  });

  it("cancels everything it armed", () => {
    const notify = vi.fn();
    const cancel = scheduleReminders([reminder("2026-08-20T09:10:00Z")], notify);

    cancel();
    vi.advanceTimersByTime(24 * 3_600_000);
    expect(notify).not.toHaveBeenCalled();
  });
});
