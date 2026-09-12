import { unambiguousCivilToInstant, type OrganizerDraft } from "@musubi/calendar";
import { describe, expect, it } from "vitest";
import { initialMeetingDraft, meetingDraftAllDay, meetingDraftForProvider } from "./provider-meeting-draft";

const draft: OrganizerDraft = {
  title: "Planning",
  description: "Keep these notes",
  location: "Room 2",
  guests: "guest@example.test, another@example.test",
  start: "2026-09-12T11:00",
  end: "2026-09-12T12:00",
  timeZone: "Europe/Prague",
  allDay: false,
};

describe("meeting calendar draft continuity", () => {
  it.each(["caldav", "microsoft"] as const)("preserves the draft and exact instants when switching to %s", provider => {
    const converted = meetingDraftForProvider(draft, provider);
    expect(converted).toEqual({ ...draft, start: "2026-09-12T09:00:00.000", end: "2026-09-12T10:00:00.000", timeZone: "UTC" });
    expect(meetingDraftForProvider(converted, "google")).toBe(converted);
  });

  it("preserves a meeting crossing the winter offset transition, including seconds", () => {
    const original = { ...draft, start: "2026-10-25T01:30:15.123", end: "2026-10-25T03:30:45.456" };
    const converted = meetingDraftForProvider(original, "caldav");
    for (const field of ["start", "end"] as const) {
      expect(unambiguousCivilToInstant(converted[field], converted.timeZone)).toEqual(unambiguousCivilToInstant(original[field], original.timeZone));
    }
    expect(converted.start).toBe("2026-10-24T23:30:15.123");
    expect(converted.end).toBe("2026-10-25T02:30:45.456");
  });

  it.each([
    { start: "2026-03-29T02:30", end: "2026-03-29T03:30" },
    { start: "2026-10-25T02:30", end: "2026-10-25T03:30" },
    { start: "" },
    { timeZone: "Invalid/Zone" },
    { end: "2026-09-12T10:00" },
  ])("blocks uncertain or invalid conversion without changing the draft: %j", patch => {
    const original = { ...draft, ...patch };
    const before = { ...original };
    expect(() => meetingDraftForProvider(original, "microsoft")).toThrow("Your draft has been kept");
    expect(original).toEqual(before);
  });

  it("keeps all-day calendar dates while changing provider", () => {
    const original = { ...draft, allDay: true, start: "2026-09-12", end: "2026-09-13" };
    expect(meetingDraftForProvider(original, "microsoft")).toEqual({ ...original, timeZone: "UTC" });
  });

  it.each(["2026-03-29", "2026-10-25", "2026-12-31"])("gives a same-day timed draft an exclusive all-day end across %s", date => {
    const original = { ...draft, start: `${date}T11:00`, end: `${date}T12:00` };
    const next = meetingDraftAllDay(original, true);
    const tomorrow = new Date(`${date}T00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    expect(next).toEqual({ ...original, allDay: true, end: `${tomorrow.toISOString().slice(0, 10)}T12:00` });
  });

  it("keeps a later end date and restores valid timed inputs after editing all-day dates", () => {
    const original = { ...draft, end: "2026-09-14T12:00" };
    expect(meetingDraftAllDay(original, true)).toEqual({ ...original, allDay: true });
    expect(meetingDraftAllDay({ ...draft, allDay: true, start: "2026-09-13", end: "2026-09-14" }, false)).toEqual({ ...draft, start: "2026-09-13T09:00:00", end: "2026-09-14T10:00:00" });
  });

  it("starts on the requested workspace date in the target provider's supported zone", () => {
    expect(initialMeetingDraft("microsoft", "2026-12-31")).toMatchObject({ start: "2026-12-31T09:00:00", end: "2026-12-31T10:00:00", timeZone: "UTC" });
    expect(initialMeetingDraft("google", "2026-02-30").start.slice(0, 10)).not.toBe("2026-02-30");
  });
});
