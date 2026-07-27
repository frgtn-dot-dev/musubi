import type { Event } from "@musubi/types";
import { Lock, Repeat, Users } from "lucide-react";
import styles from "./workspace.module.css";

/**
 * The non-colour half of an event's identity (R9).
 *
 * The colour says which calendar; these say what kind of event it is. They are
 * `aria-hidden` because the button's label already spells everything out — this
 * is redundancy for people reading the pixels, not a second announcement.
 */
export function EventMarks({
  event,
  readOnly = false,
}: {
  event: Event;
  readOnly?: boolean;
}) {
  if (!event.recurrence && !event.hasAttendees && !readOnly) {
    return null;
  }

  return (
    <span aria-hidden="true" className={styles.eventMarks}>
      {event.recurrence ? <Repeat size={11} strokeWidth={2} /> : null}
      {event.hasAttendees ? <Users size={11} strokeWidth={2} /> : null}
      {readOnly ? <Lock size={11} strokeWidth={2} /> : null}
    </span>
  );
}
