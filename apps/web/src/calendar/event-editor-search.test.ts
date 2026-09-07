import { describe, expect, it } from "vitest";
import {
  applyEventEditorSearch,
  eventEditorSearchSchema,
} from "./event-editor-search";
import { defaultEventFormValues } from "./event-form";

describe("event editor URL drafts", () => {
  it("overrides fields carried from a compact editor", () => {
    const base = {
      ...defaultEventFormValues("personal", "2026-07-08"),
      calendarIds: ["personal", "studio"],
      hasAttendees: true,
      location: "Studio B",
      title: "Client call",
    };
    const search = eventEditorSearchSchema.parse({
      attendees: false,
      calendarId: "studio",
      calendarIds: ["studio", "family"],
      date: "2026-07-09",
      title: "Client call revised",
      view: "week",
    });

    expect(applyEventEditorSearch(base, search)).toMatchObject({
      calendarId: "studio",
      calendarIds: ["studio", "family"],
      date: "2026-07-09",
      hasAttendees: false,
      location: "Studio B",
      title: "Client call revised",
    });
  });

  it("keeps the home calendar in a de-duplicated calendar list", () => {
    const base = defaultEventFormValues("personal", "2026-07-08");
    const search = eventEditorSearchSchema.parse({
      calendarId: "studio",
      calendarIds: ["family", "family"],
      view: "month",
    });

    expect(applyEventEditorSearch(base, search)).toMatchObject({
      calendarIds: ["studio", "family"],
      date: "2026-07-08",
    });
  });
});

it("detects every restored editable override, not navigation alone", async () => {
  const { hasEventEditorContent } = await import("./event-editor-search");
  for (const input of [{ description: "" }, { endTime: "12:30" },
    { recurrence: "FREQ=DAILY" }, { calendarIds: ["copy"] }, { calendarId: "copy" },
    { allDay: false }, { attendees: false }, { endDate: "2026-01-01" },
    { location: "" }, { url: "" }, { title: "" }, { startTime: "09:00" }]) {
    expect(hasEventEditorContent(eventEditorSearchSchema.parse(input))).toBe(true);
  }
  expect(hasEventEditorContent(eventEditorSearchSchema.parse({ date: "2026-01-01", returnDate: "2026-01-02", view: "week" }))).toBe(false);
});
