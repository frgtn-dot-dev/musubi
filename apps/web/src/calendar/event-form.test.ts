import type { Event } from "@musubi/types";
import { describe, expect, it } from "vitest";
import {
  createEventFromForm,
  defaultEventFormValues,
  eventFormValues,
  updateEventFromForm,
  validateEventForm,
} from "./event-form";

describe("event form", () => {
  it("defaults quick create to a one-hour local event", () => {
    expect(
      defaultEventFormValues(
        "calendar-1",
        "2026-07-26",
        "09:30",
      ),
    ).toMatchObject({
      calendarId: "calendar-1",
      date: "2026-07-26",
      endTime: "10:30",
      startTime: "09:30",
    });
  });

  it("stores one-day all-day events as an inclusive UTC date", () => {
    const values = {
      ...defaultEventFormValues("calendar-1", "2026-07-26"),
      isAllDay: true,
      title: "Holiday",
    };
    const event = createEventFromForm(
      values,
      { email: "alex@example.com", userId: "user-1" },
      "#b3492f",
    );

    expect(event.start.toISOString()).toBe(
      "2026-07-26T00:00:00.000Z",
    );
    expect(event.end.toISOString()).toBe(
      "2026-07-26T00:00:00.000Z",
    );
  });

  it("rejects timed events whose end is not after their start", () => {
    expect(
      validateEventForm({
        ...defaultEventFormValues("calendar-1", "2026-07-26"),
        endTime: "09:00",
        startTime: "10:00",
        title: "Invalid",
      }),
    ).toBe("End time must be after start time.");
  });

  it("preserves identity and links during quick edit", () => {
    const event = {
      ...createEventFromForm(
        {
          ...defaultEventFormValues("calendar-1", "2026-07-26"),
          title: "Before",
        },
        { email: "alex@example.com", userId: "user-1" },
        "#b3492f",
      ),
      calendars: ["calendar-1", "calendar-2"],
      originCalendarID: "calendar-1",
    } satisfies Event;
    const updated = updateEventFromForm(event, {
      ...eventFormValues(event),
      location: "Studio",
      title: "After",
    });

    expect(updated).toMatchObject({
      calendars: ["calendar-1", "calendar-2"],
      creatorID: event.creatorID,
      id: event.id,
      location: "Studio",
      originCalendarID: "calendar-1",
      title: "After",
    });
  });
});
