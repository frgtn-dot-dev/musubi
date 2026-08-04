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
import { EventMarks } from "./EventMarks";
import styles from "./workspace.module.css";

type EventPopoverProps = EventActionHandlers & {
  calendar: Calendar | undefined;
  calendars: Calendar[];
  continuesAfter?: boolean;
  continuesBefore?: boolean;
  /**
   * This chip is being dragged elsewhere: what stays here is the shape it would
   * leave behind, so the day it came from stays readable.
   */
  ghost?: boolean;
  event: Event;
  /** Absent when the event may not be moved by dragging. */
  onBeginDrag?: (pointerEvent: React.PointerEvent<HTMLElement>) => void;
  /** A write for this event is in flight. */
  pending?: boolean;
  showLabel?: boolean;
  timeFormat: Settings["timeFormat"];
  weekStartsOn: Settings["weekStartsOn"];
};

export function EventPopover({
  calendar,
  calendars,
  continuesAfter = false,
  continuesBefore = false,
  event,
  ghost = false,
  onBeginDrag,
  pending = false,
  showLabel = true,
  timeFormat,
  weekStartsOn,
  ...eventActions
}: EventPopoverProps) {
  const eventColor = calendar?.color ?? event.color;

  return (
    <EventDetailsPopover
      calendar={calendar}
      calendars={calendars}
      event={event}
      timeFormat={timeFormat}
      weekStartsOn={weekStartsOn}
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
        aria-busy={pending || undefined}
        data-ghost={ghost ? "" : undefined}
        data-draggable={onBeginDrag ? "" : undefined}
        data-pending={pending ? "" : undefined}
        data-event-id={event.id}
        onPointerDown={onBeginDrag}
        style={
          {
            "--event-color": eventColor,
            // A ghost is drawn as an outline over the page, not as a filled
            // block, so the event's own foreground would be white on a 18%
            // tint. Ink is what stays readable there.
            "--event-foreground": ghost
              ? "var(--text-secondary)"
              : getReadableEventTextColor(eventColor),
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
        {showLabel ? <EventMarks event={event} /> : null}
      </button>
    </EventDetailsPopover>
  );
}
