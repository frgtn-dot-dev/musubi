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
