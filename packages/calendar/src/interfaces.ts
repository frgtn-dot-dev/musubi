import type {
  EventTimeModel,
  OccurrenceStart,
  OccurrenceIdentity,
} from "@musubi/types";
// Minimal event shape the recurrence/date helpers need — the client's full
// Event type satisfies it structurally.
export interface ICalendarEventBase {
  id?: string;
  start: Date;
  end: Date;
  title: string;
  isAllDay?: boolean;
  recurrence?: string | null;
  timeModel?: EventTimeModel | null;
  seriesID?: string | null;
  originalStart?: OccurrenceStart | null;
  occurrenceIdentity?: OccurrenceIdentity;
  isCanceled?: boolean;
}

export type Mode = "3days" | "week" | "day" | "custom" | "month" | "schedule";
