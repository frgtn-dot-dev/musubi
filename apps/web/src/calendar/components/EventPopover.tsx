import * as Popover from "@radix-ui/react-popover";
import type { Calendar, Event, Settings } from "@musubi/types";
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
  getEventDateLabel,
  getEventRangeLabel,
} from "../calendar-math";
import { getReadableEventTextColor } from "../event-color";
import styles from "./workspace.module.css";

type EventPopoverProps = {
  calendar: Calendar | undefined;
  continuesAfter?: boolean;
  continuesBefore?: boolean;
  event: Event;
  showLabel?: boolean;
  timeFormat: Settings["timeFormat"];
};

export function EventPopover({
  calendar,
  continuesAfter = false,
  continuesBefore = false,
  event,
  showLabel = true,
  timeFormat,
}: EventPopoverProps) {
  const eventColor = calendar?.color ?? event.color;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className={`${styles.eventChip} ${
            event.isAllDay ? styles.eventChipAllDay : ""
          } ${continuesBefore ? styles.eventChipContinuesBefore : ""} ${
            continuesAfter ? styles.eventChipContinuesAfter : ""
          } ${
            continuesBefore && continuesAfter
              ? styles.eventChipContinuesBoth
              : ""
          } ${
            event.isAllDay && showLabel ? styles.eventChipLabelVisible : ""
          }`}
          type="button"
          aria-label={`${event.title}, ${getEventDateLabel(
            event,
          )}, ${getEventRangeLabel(event, timeFormat)}, ${calendar?.name ?? "calendar"}`}
          data-event-id={event.id}
          style={
            {
              "--event-color": eventColor,
              "--event-foreground": getReadableEventTextColor(eventColor),
            } as React.CSSProperties
          }
          onClick={(clickEvent) => clickEvent.stopPropagation()}
        >
          {!event.isAllDay ? (
            <span className={styles.eventTime} aria-hidden="true">
              {getEventRangeLabel(event, timeFormat).split(" ")[0]}
            </span>
          ) : null}
          <span className={styles.eventTitle} aria-hidden="true">
            {showLabel ? event.title : ""}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={`${styles.popover} ${styles.detailPopover}`}
          align="start"
          aria-label={event.title}
          side="bottom"
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
              <dd>{getEventDateLabel(event)}</dd>
            </div>
            <div>
              <Clock3 aria-hidden="true" size={17} strokeWidth={1.5} />
              <dt>Time</dt>
              <dd>{getEventRangeLabel(event, timeFormat)}</dd>
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
                <dd>Attendee tracking enabled</dd>
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
            Read-only data from this Musubi server.
          </p>
          <Popover.Arrow className={styles.popoverArrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
