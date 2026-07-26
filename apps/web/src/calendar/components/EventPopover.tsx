import * as Popover from "@radix-ui/react-popover";
import type { Calendar, Event } from "@musubi/types";
import {
  CalendarDays,
  Clock3,
  FileText,
  MapPin,
  Repeat2,
  UsersRound,
  X,
} from "lucide-react";
import {
  getEventRangeLabel,
  getLongDateLabel,
} from "../calendar-math";
import styles from "./workspace.module.css";

type EventPopoverProps = {
  calendar: Calendar | undefined;
  event: Event;
};

export function EventPopover({ calendar, event }: EventPopoverProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className={styles.eventChip}
          type="button"
          aria-label={`${event.title}, ${getEventRangeLabel(event)}, ${
            calendar?.name ?? "calendar"
          }`}
          style={
            {
              "--event-color": calendar?.color ?? event.color,
            } as React.CSSProperties
          }
          onClick={(clickEvent) => clickEvent.stopPropagation()}
        >
          <span className={styles.eventDot} aria-hidden="true" />
          <span className={styles.eventTime}>
            {event.isAllDay ? "" : getEventRangeLabel(event).split(" ")[0]}
          </span>
          <span className={styles.eventTitle}>{event.title}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={`${styles.popover} ${styles.detailPopover}`}
          align="start"
          aria-label={event.title}
          side="right"
          sideOffset={8}
          collisionPadding={14}
        >
          <div className={styles.popoverHeader}>
            <div>
              <h2>{event.title}</h2>
              <p className={styles.detailCalendar}>
                <span
                  className={styles.calendarDot}
                  style={{ backgroundColor: calendar?.color ?? event.color }}
                />
                {calendar?.name ?? "Calendar"}
              </p>
            </div>
            <Popover.Close asChild>
              <button
                className={styles.iconButton}
                type="button"
                aria-label="Close event details"
              >
                <X aria-hidden="true" size={17} strokeWidth={1.6} />
              </button>
            </Popover.Close>
          </div>

          <dl className={styles.detailList}>
            <div>
              <CalendarDays aria-hidden="true" size={17} strokeWidth={1.5} />
              <dt>Date</dt>
              <dd>{getLongDateLabel(event.start)}</dd>
            </div>
            <div>
              <Clock3 aria-hidden="true" size={17} strokeWidth={1.5} />
              <dt>Time</dt>
              <dd>{getEventRangeLabel(event)}</dd>
            </div>
            {event.recurrence ? (
              <div>
                <Repeat2 aria-hidden="true" size={17} strokeWidth={1.5} />
                <dt>Repeat</dt>
                <dd>Every week</dd>
              </div>
            ) : null}
            {event.hasAttendees ? (
              <div>
                <UsersRound aria-hidden="true" size={17} strokeWidth={1.5} />
                <dt>Attendees</dt>
                <dd>Alex Kim and 2 more</dd>
              </div>
            ) : null}
            {event.location ? (
              <div>
                <MapPin aria-hidden="true" size={17} strokeWidth={1.5} />
                <dt>Location</dt>
                <dd>{event.location}</dd>
              </div>
            ) : null}
            {event.description ? (
              <div>
                <FileText aria-hidden="true" size={17} strokeWidth={1.5} />
                <dt>Notes</dt>
                <dd>{event.description}</dd>
              </div>
            ) : null}
          </dl>

          <p className={styles.prototypeNote}>
            Read-only fixture · editing connects with the event API slice.
          </p>
          <Popover.Arrow className={styles.popoverArrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
