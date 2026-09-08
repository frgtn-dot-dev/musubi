import type { EventTimeModel, OccurrenceStart } from "@musubi/types";
import { expandRecurringEvents } from "@musubi/calendar";

const INVITE_PREVIEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type PreviewCalendar = {
  id: string;
  name: string;
  color: string;
};

type PreviewMember = {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
};

type PreviewEvent = {
  events: {
    id: string;
    title: string;
    color: string;
    start: Date;
    end: Date;
    isAllDay: boolean;
    recurrence?: string | null;
    isCanceled?: boolean;
    timeModel?: EventTimeModel | null;
    seriesID?: string | null;
    originalStart?: OccurrenceStart | null;
    deletedAt?: Date | null;
  };
};

/**
 * The invite token is a capability, but preview possession should reveal only
 * what the invite screen renders: public profile labels and a 30-day agenda.
 */
export function buildInvitePreview(
  calendar: PreviewCalendar,
  members: PreviewMember[],
  rows: PreviewEvent[],
  now = new Date(),
) {
  const previewEndsAt = new Date(now.getTime() + INVITE_PREVIEW_WINDOW_MS);
  // Include the whole first UTC date for legacy inclusive all-day ends. The
  // final filter still enforces the exact instant window for timed events.
  const expansionStartsAt = new Date(
    `${now.toISOString().slice(0, 10)}T00:00:00.000Z`,
  );
  const eventDefinitions = rows
    .map((row) => row.events)
    .filter((event) => !event.deletedAt)
    .map((event) => ({
      id: event.id,
      title: event.title,
      color: event.color,
      start: event.start,
      end: event.end,
      isAllDay: event.isAllDay,
      recurrence: event.recurrence ?? null,
      isCanceled: event.isCanceled,
      timeModel: event.timeModel,
      seriesID: event.seriesID,
      originalStart: event.originalStart,
    }));
  const events = expandRecurringEvents(
    eventDefinitions,
    expansionStartsAt,
    previewEndsAt,
    {
      consumerTimeZone: "UTC",
    },
  )
    // Legacy recurrence may fall back to the source event for malformed rules; retain the privacy window even in that case.
    .filter(
      (event) =>
        !event.isCanceled &&
        (event.isAllDay
          ? event.end.toISOString().slice(0, 10) >=
              now.toISOString().slice(0, 10) &&
            event.start.toISOString().slice(0, 10) <=
              previewEndsAt.toISOString().slice(0, 10)
          : event.end >= now && event.start <= previewEndsAt),
    )
    .map((event) => ({
      // Keep the anonymous preview DTO explicit: definition metadata and
      // private event fields must not leak through a spread of expansion output.
      id: event.id,
      title: event.title,
      color: event.color,
      start: event.start,
      end: event.end,
      isAllDay: event.isAllDay,
      // These are already concrete occurrences. Sending the rule would make
      // the client expand each occurrence a second time.
      recurrence: null,
    }));

  return {
    id: calendar.id,
    name: calendar.name,
    color: calendar.color,
    members: members.map(({ user }) => ({
      id: user.id,
      name: user.name,
      image: user.image ?? null,
    })),
    events,
  };
}
