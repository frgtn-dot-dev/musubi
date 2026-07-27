import type { Calendar, Event, Settings } from "@musubi/types";
import {
  getEventDateLabel,
  getEventRangeLabel,
} from "../calendar-math";
import { getReadableEventTextColor } from "../event-color";
import {
  EventDetailsPopover,
  type EventActionHandlers,
} from "./EventDetailsPopover";
import styles from "./workspace.module.css";

type EventPopoverProps = EventActionHandlers & {
  calendar: Calendar | undefined;
  calendars: Calendar[];
  continuesAfter?: boolean;
  continuesBefore?: boolean;
  /** Set while this chip is being dragged to another day. */
  dragging?: boolean;
  event: Event;
  /** Absent when the event may not be moved by dragging. */
  onBeginDrag?: (pointerEvent: React.PointerEvent<HTMLElement>) => void;
  showLabel?: boolean;
  timeFormat: Settings["timeFormat"];
};

export function EventPopover({
  calendar,
  calendars,
  continuesAfter = false,
  continuesBefore = false,
  dragging = false,
  event,
  onBeginDrag,
  showLabel = true,
  timeFormat,
  ...eventActions
}: EventPopoverProps) {
  const eventColor = calendar?.color ?? event.color;

  return (
    <EventDetailsPopover
      calendar={calendar}
      calendars={calendars}
      event={event}
      timeFormat={timeFormat}
      {...eventActions}
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
        data-dragging={dragging ? "" : undefined}
        data-draggable={onBeginDrag ? "" : undefined}
        data-event-id={event.id}
        onPointerDown={onBeginDrag}
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
