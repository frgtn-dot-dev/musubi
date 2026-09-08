import { describe, expect, it, vi } from "vitest";
import { eventReminder, inheritedEventReminder, type ReminderControl } from "./reminder-control";

function fixture(): ReminderControl {
  return {
    calendarOrder: ["work"],
    document: {
      default: { minutesBefore: 10, allDay: null },
      calendars: { work: { minutesBefore: 30, allDay: null } },
      events: {
        series: { minutesBefore: 60, allDay: null },
        detached: { minutesBefore: 5, allDay: null },
      },
    },
    push: { available: false, enabled: false, set: vi.fn() },
    onChange: vi.fn(),
    onCalendarChange: vi.fn(),
  };
}

const detached = { id: "detached", seriesID: "series", calendars: ["work"] };

describe("reminder inheritance in the event editor", () => {
  it("shows the detached override and restores the series rule without mutating the document", () => {
    const control = fixture();
    const before = structuredClone(control.document);
    expect(eventReminder(control, detached)).toEqual({ inherited: false, rule: before.events.detached });
    expect(inheritedEventReminder(control, detached)).toEqual({ inherited: true, rule: before.events.series });
    expect(control.document).toEqual(before);
    delete control.document.events.detached;
    expect(eventReminder(control, detached)).toEqual({ inherited: true, rule: before.events.series });
  });

  it("keeps a calendar-valued override when its series would schedule differently", () => {
    const control = fixture();
    control.document.events.detached = control.document.calendars.work!;
    expect(eventReminder(control, detached).rule.minutesBefore).toBe(30);
    expect(inheritedEventReminder(control, detached).rule.minutesBefore).toBe(60);
  });

  it("falls back from series to calendar to default", () => {
    const control = fixture();
    expect(inheritedEventReminder(control, { id: "series", calendars: ["work"] }).rule.minutesBefore).toBe(30);
    delete control.document.events.series;
    expect(inheritedEventReminder(control, detached).rule.minutesBefore).toBe(30);
    delete control.document.calendars.work;
    expect(inheritedEventReminder(control, detached).rule.minutesBefore).toBe(10);
  });
});
