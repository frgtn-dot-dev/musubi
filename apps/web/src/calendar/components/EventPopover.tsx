import type { Calendar, Event, Settings } from "@musubi/types";
import {
  getEventDateLabel,
  getEventRangeLabel,
} from "../calendar-math";
import { getReadableEventTextColor } from "../event-color";
import { EventDetailsPopover } from "./EventDetailsPopover";
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
    <EventDetailsPopover
      calendar={calendar}
      event={event}
      timeFormat={timeFormat}
    >
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
    </EventDetailsPopover>
  );
}
