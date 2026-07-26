import {
  can,
  providerDisplayName,
  type Calendar,
  type Event,
} from "@musubi/types";
import { ApiError, ApiResponseError } from "~/api/http";

export function getEditableCalendars(calendars: Calendar[]) {
  return calendars.filter((calendar) =>
    can(calendar.role, "editEvents"),
  );
}

export function canEditEvent(event: Event, calendars: Calendar[]) {
  if (event.originCalendarID) {
    return can(
      calendars.find(
        (calendar) => calendar.id === event.originCalendarID,
      )?.role,
      "editEvents",
    );
  }

  return event.calendars.some((calendarId) =>
    can(
      calendars.find((calendar) => calendar.id === calendarId)?.role,
      "editEvents",
    ),
  );
}

export function canRemoveEvent(event: Event, calendars: Calendar[]) {
  return event.calendars.some((calendarId) =>
    can(
      calendars.find((calendar) => calendar.id === calendarId)?.role,
      "editEvents",
    ),
  );
}

export function getEventHomeCalendar(
  event: Event,
  calendars: Calendar[],
) {
  const homeId = event.originCalendarID ?? event.calendars[0];
  return calendars.find((calendar) => calendar.id === homeId);
}

type MutationAction = "create" | "delete" | "update";

const actionCopy: Record<MutationAction, string> = {
  create: "create",
  delete: "delete",
  update: "save",
};

export function getEventMutationError(
  error: unknown,
  action: MutationAction,
  calendar?: Calendar,
) {
  const requestId =
    error instanceof ApiError || error instanceof ApiResponseError
      ? error.requestId
      : undefined;

  if (error instanceof ApiError && error.status === 403) {
    return {
      message:
        "Your calendar access changed. Reload before trying this action again.",
      requestId,
    };
  }

  if (calendar?.provider) {
    return {
      message: `${providerDisplayName(
        calendar,
      )} did not confirm this change. Refresh the calendar before retrying to avoid a duplicate.`,
      requestId,
    };
  }

  if (
    error instanceof DOMException ||
    error instanceof TypeError
  ) {
    return {
      message:
        "Musubi could not be reached. Check your connection and try again.",
      requestId,
    };
  }

  return {
    message: `Musubi could not ${actionCopy[action]} this event. ${
      error instanceof Error ? error.message : "Try again."
    }`,
    requestId,
  };
}

export function isQuickEditableEvent(event: Event) {
  if (event.recurrence) {
    return false;
  }

  if (!event.isAllDay) {
    return true;
  }

  return event.end.getTime() - event.start.getTime() <= 86_400_000;
}
