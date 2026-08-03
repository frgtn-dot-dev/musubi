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
  /**
   * Which line of the day cell this block takes, counted from zero. All-day
   * bars are given the same one in every cell they cross; without it each cell
   * stacks in its own order and a bar arrives at three different heights.
   */
  row?: number;
  showLabel?: boolean;
  /**
   * Draw this block across a whole week rather than inside one day cell. An
   * all-day event is one event, so the month shows it as one bar.
   */
  span?: {
    /** How many day cells it reaches across, this cell included. */
    columns: number;
    lane: number;
  };
  timeFormat: Settings["timeFormat"];
  weekStartsOn: Settings["weekStartsOn"];
};

/**
 * Lights up every segment of one event at once.
 *
 * A multi-day event is one block per day it crosses, so `:hover` lifts the
 * segment under the pointer and leaves the rest of the same event flat. Done to
 * the DOM rather than through state: hover state at grid level would re-render
 * every block in the month on each pointer move, which is what the many-events
 * work went to some trouble to avoid.
 */
function markSpanHovered(eventId: string, hovered: boolean) {
  for (const node of document.querySelectorAll(
    `[data-event-id="${CSS.escape(eventId)}"]`,
  )) {
    node.toggleAttribute("data-hovered", hovered);
  }
}

export function EventPopover({
  calendar,
  calendars,
  continuesAfter = false,
  continuesBefore = false,
  event,
  ghost = false,
  onBeginDrag,
  pending = false,
  row,
  showLabel = true,
  span,
  timeFormat,
  weekStartsOn,
  ...eventActions
}: EventPopoverProps) {
  const eventColor = calendar?.color ?? event.color;
  // Only a block that carries on into another cell has siblings to light up.
  const spans = continuesBefore || continuesAfter;

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
        className={`${styles.eventChip} ${span ? styles.eventChipBar : ""} ${
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
        onPointerEnter={
          spans ? () => markSpanHovered(event.id, true) : undefined
        }
        onPointerLeave={
          spans ? () => markSpanHovered(event.id, false) : undefined
        }
        style={
          {
            /* The lane this block was given for the whole week, so a bar keeps
               one line across every day it crosses. */
            gridRow: row === undefined ? undefined : row + 1,
            ...(span
              ? {
                  gridRow: span.lane + 1,
                  /* Each further cell adds its own width plus the gutter this
                     one's padding and divider take out of it. */
                  width: `calc(${span.columns} * 100% + ${span.columns} * var(--month-cell-gutter))`,
                }
              : {}),
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
