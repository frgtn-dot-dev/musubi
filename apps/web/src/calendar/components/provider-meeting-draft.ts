import {
  instantToCivil,
  organizerDraft,
  unambiguousCivilToInstant,
  type OrganizerDraft,
} from "@musubi/calendar";
import { shiftDayKey } from "../date-key";

export type MeetingProvider = "google" | "caldav" | "microsoft";

export function initialMeetingDraft(provider: MeetingProvider, initialDate?: string): OrganizerDraft {
  const draft = organizerDraft(undefined, provider);
  if (initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) {
    const date = new Date(`${initialDate}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === initialDate) {
      return { ...draft, start: `${initialDate}T09:00:00`, end: `${initialDate}T10:00:00` };
    }
  }
  return draft;
}

/** A different provider may require UTC, but cannot change the intended instant. */
export function meetingDraftForProvider(draft: OrganizerDraft, provider: MeetingProvider): OrganizerDraft {
  if (provider === "google" || draft.timeZone === "UTC") return draft;
  if (draft.allDay) return { ...draft, timeZone: "UTC" };
  try {
    const civil = (value: string) => value.length === 16 ? `${value}:00` : value;
    const start = unambiguousCivilToInstant(civil(draft.start), draft.timeZone);
    const end = unambiguousCivilToInstant(civil(draft.end), draft.timeZone);
    if (end < start) throw new Error("End precedes start");
    return {
      ...draft,
      start: instantToCivil(start, "UTC"),
      end: instantToCivil(end, "UTC"),
      timeZone: "UTC",
    };
  } catch {
    throw new Error("Choose valid, unambiguous start and end times before switching calendars. Your draft has been kept.");
  }
}

/** All-day end dates are exclusive, including a timed draft contained in one day. */
export function meetingDraftAllDay(draft: OrganizerDraft, allDay: boolean): OrganizerDraft {
  if (allDay === draft.allDay) return draft;
  if (!allDay) return {
    ...draft,
    allDay,
    start: draft.start.length === 10 ? `${draft.start}T09:00:00` : draft.start,
    end: draft.end.length === 10 ? `${draft.end}T10:00:00` : draft.end,
  };
  const startDate = draft.start.slice(0, 10);
  const endDate = draft.end.slice(0, 10);
  const date = new Date(`${startDate}T00:00:00.000Z`);
  const validStart = !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === startDate;
  return {
    ...draft,
    allDay,
    end: validStart && endDate <= startDate ? `${shiftDayKey(startDate, 1)}${draft.end.slice(10)}` : draft.end,
  };
}
