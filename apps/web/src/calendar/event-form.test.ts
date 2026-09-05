import type { Event } from "@musubi/types";
import { describe, expect, it } from "vitest";
import {
  createEventFromForm,
  defaultEventFormValues,
  eventFormValues,
  selectHomeCalendar,
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

  it("creates a recurring multi-calendar, multi-day event", () => {
    const event = createEventFromForm(
      {
        ...defaultEventFormValues("calendar-1", "2026-07-26"),
        calendarIds: ["calendar-1", "calendar-2"],
        description: "Bring a tent",
        endDate: "2026-07-29",
        hasAttendees: true,
        isAllDay: true,
        recurrence: "FREQ=YEARLY",
        title: "Camp",
        url: "https://example.com/camp",
      },
      { email: "alex@example.com", userId: "user-1" },
      "#b3492f",
    );

    expect(event).toMatchObject({
      calendars: ["calendar-1", "calendar-2"],
      description: "Bring a tent",
      hasAttendees: true,
      recurrence: "FREQ=YEARLY",
      url: "https://example.com/camp",
    });
    expect(event.end.toISOString()).toBe(
      "2026-07-29T00:00:00.000Z",
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

  it("replaces the default-only calendar when a new home is chosen", () => {
    expect(
      selectHomeCalendar(
        { calendarId: "personal", calendarIds: ["personal"] },
        "studio",
        () => "home",
      ),
    ).toEqual({
      calendarId: "studio",
      calendarIds: ["studio"],
      removedCalendarCount: 1,
    });
  });

  it("keeps deliberate links on the new home's server", () => {
    const servers = new Map([
      ["personal", "home"],
      ["studio", "home"],
      ["family", "home"],
    ]);

    expect(
      selectHomeCalendar(
        {
          calendarId: "personal",
          calendarIds: ["personal", "family"],
        },
        "studio",
        (calendarId) => servers.get(calendarId) ?? "home",
      ),
    ).toEqual({
      calendarId: "studio",
      calendarIds: ["studio", "personal", "family"],
      removedCalendarCount: 0,
    });
  });

  it("drops memberships that cannot follow a home to another server", () => {
    const servers = new Map([
      ["personal", "home"],
      ["family", "home"],
      ["remote-main", "remote"],
      ["remote-team", "remote"],
    ]);

    expect(
      selectHomeCalendar(
        {
          calendarId: "personal",
          calendarIds: ["personal", "family", "remote-team"],
        },
        "remote-main",
        (calendarId) => servers.get(calendarId) ?? "home",
      ),
    ).toEqual({
      calendarId: "remote-main",
      calendarIds: ["remote-main", "remote-team"],
      removedCalendarCount: 2,
    });
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


describe("timed end date validation", () => {
  it.each([
    ["2026-07-27", "01:00", null],
    ["2026-07-29", "23:00", null],
    ["2026-07-25", "23:59", "End time must be after start time."],
    ["2026-07-26", "23:00", "End time must be after start time."],
    ["", "01:00", "End time must be after start time."],
    ["2026-07-27", "invalid", "End time must be after start time."],
  ])("validates end %s %s against the complete start", (endDate, endTime, error) => {
    expect(validateEventForm({ ...defaultEventFormValues("calendar-1", "2026-07-26", "23:00"), title: "Night", endDate: endDate!, endTime: endTime! })).toBe(error);
  });
});

describe("K06 untouched nullable text", () => {
  for (const text of ["  preserved text\n", "", "   "]) {
    it(`preserves exact unchanged text ${JSON.stringify(text)} in a title-only PATCH`, async () => {
      const { eventPatchRequest } = await import("@musubi/types");
      const baseline = {
        ...createEventFromForm({ ...defaultEventFormValues("calendar-1", "2026-07-26"), title: "Before" },
          { userId: "user-1", email: "a@example.test" }, "#112233"),
        revision: 1, description: text, location: text, url: text,
      };
      expect(eventPatchRequest(updateEventFromForm(baseline, {
        ...eventFormValues(baseline), title: "After",
      })).patch).toEqual({ title: "After" });
      if (text !== "") expect(eventPatchRequest(updateEventFromForm(baseline, {
        ...eventFormValues(baseline), description: "", location: "", url: "",
      })).patch).toEqual({ description: null, location: null, url: null });
    });
  }
});
