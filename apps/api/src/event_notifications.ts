import { logger } from "@musubi/config";
import {
  dropPendingNotificationsFor,
  getEventAttendees,
  queuePendingNotification,
} from "@musubi/db";
import { batchDueAt, EVENT_CHANGED } from "./notification_dispatch";

/**
 * Telling the guests when something they were coming to changes.
 *
 * Only the guests: an event lives in calendars that can have thirty members,
 * and mailing all of them every time somebody fixes a typo is how a product
 * teaches people to filter it into a folder they never open.
 */

/**
 * What is stored on the queue, in the reader-agnostic form.
 *
 * Times stay as ISO instants rather than sentences, because the sentence
 * depends on who is reading — the drain knows each recipient's zone and formats
 * there. Storing "14:00" would freeze one person's afternoon into everybody's.
 */
export type EventChangePayload = {
  isAllDay: boolean;
  kind: "cancelled" | "moved";
  /** The instant it starts now. */
  start: string;
  title: string;
  /** Where it used to start, so a move can say what it moved from. */
  wasStart?: string;
};

type EventTiming = {
  end: Date;
  id: string;
  isAllDay: boolean;
  isCanceled: boolean;
  start: Date;
  title: string;
};

/**
 * What actually counts as news.
 *
 * A description, a colour, a location: not news. The time moving or the event
 * being called off: news. Un-cancelling is deliberately silent — the event
 * simply reappears, and "it is back on" arriving after "it is off" reads as
 * noise unless somebody asked.
 */
export function describeChange(
  previous: Pick<EventTiming, "isCanceled" | "start" | "end">,
  updated: EventTiming,
): EventChangePayload | null {
  if (updated.isCanceled && !previous.isCanceled) {
    return {
      isAllDay: updated.isAllDay,
      kind: "cancelled",
      start: updated.start.toISOString(),
      title: updated.title,
    };
  }
  if (updated.isCanceled) return null;

  const moved =
    previous.start.getTime() !== updated.start.getTime() ||
    previous.end.getTime() !== updated.end.getTime();
  if (!moved) return null;

  return {
    isAllDay: updated.isAllDay,
    kind: "moved",
    start: updated.start.toISOString(),
    title: updated.title,
    wasStart: previous.start.toISOString(),
  };
}

/**
 * Queue the change for everyone coming, except whoever made it.
 *
 * Best-effort by design: this runs after the write has committed and the
 * response is owed to the client. A mail queue that cannot be written to must
 * not turn a successful edit into an error.
 */
export async function queueEventChange(
  previous: Pick<EventTiming, "isCanceled" | "start" | "end">,
  updated: EventTiming,
  actorID: string,
) {
  const change = describeChange(previous, updated);
  if (!change) return;

  try {
    const attendees = await getEventAttendees(updated.id);
    const dueAt = batchDueAt();

    for (const attendee of attendees) {
      // Declined is an answer, and it was no. The person who made the change
      // knows already.
      if (attendee.status === "declined" || attendee.id === actorID) continue;

      await queuePendingNotification({
        dueAt,
        kind: EVENT_CHANGED,
        payload: change,
        subjectID: updated.id,
        userID: attendee.id,
      });
    }
  } catch (error) {
    logger.error("notifications.queue_failed", { error, eventID: updated.id });
  }
}

/** The event is gone; anything queued about it is now a message about nothing. */
export async function dropEventNotifications(eventID: string) {
  await dropPendingNotificationsFor(EVENT_CHANGED, eventID).catch((error) =>
    logger.error("notifications.drop_failed", { error, eventID }),
  );
}
