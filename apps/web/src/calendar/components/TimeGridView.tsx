import type { Calendar, Event, Settings } from "@musubi/types";
import {
  addDays,
  bucketEventsByDay,
  dayKey,
  getAllDaySpans,
  getDaySegments,
  isSameDay,
  startOfDay,
} from "@musubi/calendar/layout";
import {
  type CSSProperties,
  type KeyboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getEventDateLabel, getEventRangeLabel } from "../calendar-math";
import { getReadableEventTextColor } from "../event-color";
import {
  durationToHeight,
  minutesToY,
  yToMinutes,
  type TimeGeometry,
} from "../time-geometry";
import { canEditEvent } from "../event-permissions";
import { EventMarks } from "./EventMarks";
import {
  nextDragTimes,
  type DragMode,
  type DragTimes,
} from "../time-grid-drag";
import {
  useDragToCreate,
  useTimeGridDrag,
  type BeginDragInput,
} from "../use-time-grid-drag";
import { getTimeGridDays, type TimeGridViewId } from "../time-grid-math";
import {
  EventDetailsPopover,
  type EventActionHandlers,
} from "./EventDetailsPopover";
import styles from "./workspace.module.css";

const INITIAL_SCROLL_HOUR = 7;
const ALL_DAY_LANES = 3;
const longWeekdayFormatter = new Intl.DateTimeFormat("en", {
  weekday: "long",
});
const shortWeekdayFormatter = new Intl.DateTimeFormat("en", {
  weekday: "short",
});
const hour12Formatter = new Intl.DateTimeFormat("en", {
  hour: "numeric",
  hour12: true,
});
const timeZoneFormatter = new Intl.DateTimeFormat("en", {
  timeZoneName: "shortOffset",
});

type TimeGridViewProps = EventActionHandlers & {
  anchor: Date;
  /** The event a write is in flight for, so its block can say so. */
  busyEventId?: string;
  calendars: Calendar[];
  events: Event[];
  geometry: TimeGeometry;
  /**
   * Commit a drag or resize. Absent (or returning without moving) leaves the
   * grid read-only for direct manipulation.
   */
  onMoveEvent?: (input: {
    dayOffset: number;
    end: Date;
    event: Event;
    start: Date;
  }) => Promise<unknown>;
  /**
   * The slot a quick-create popover is currently open for. The selection stays
   * visible for as long as the popover is, so the interval being described never
   * disappears out from under it.
   */
  pendingCreate?: {
    date: string;
    endTime?: string;
    startTime?: string;
  };
  /**
   * Move or resize the draft a drag-to-create laid down, while its popover is
   * open. Absent leaves the draft as a still highlight.
   */
  onMoveDraft?: (input: {
    date: string;
    endTime: string;
    startTime: string;
  }) => void;
  /** Page presentation: a five-column working week when false. */
  showWeekend?: boolean;
  onCreateAtTime?: (
    date: string,
    time: string,
    anchor: { returnFocus: HTMLElement; x: number; y: number },
    /** Present when the interval was dragged rather than clicked. */
    endTime?: string,
  ) => void;
  timeFormat: Settings["timeFormat"];
  view: TimeGridViewId;
  weekStartsOn: Settings["weekStartsOn"];
};

type TimelineEventProps = EventActionHandlers & {
  calendar: Calendar | undefined;
  calendars: Calendar[];
  dayIndex: number;
  dayMode: boolean;
  daySegment: ReturnType<typeof getDaySegments<Event>>[number];
  /** Live times while this event is being dragged, else undefined. */
  dragTimes?: DragTimes;
  /** A write for this event is in flight. */
  pending?: boolean;
  draggable: boolean;
  geometry: TimeGeometry;
  onBeginDrag: (input: BeginDragInput) => void;
  onKeyboardAdjust: (event: Event, times: DragTimes) => void;
  timeFormat: Settings["timeFormat"];
};

function hourLabel(hour: number, timeFormat: Settings["timeFormat"]) {
  if (timeFormat === "24h") {
    return `${String(hour).padStart(2, "0")}:00`;
  }

  return hour12Formatter.format(new Date(2026, 0, 1, hour));
}

/** `HH:MM` back to a minute of the day. */
function clockMinutes(value: string): number {
  const [hour, minute] = value.split(":");
  return Number(hour ?? 0) * 60 + Number(minute ?? 0);
}

/** A minute of the day as an `HH:MM` form value. */
function clockValue(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = Math.floor(minutes % 60);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** A minute of the day as a clock time, for live drag feedback. */
function minuteLabel(
  minutes: number,
  timeFormat: Settings["timeFormat"],
): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = Math.floor(minutes % 60);

  if (timeFormat === "12h") {
    return new Intl.DateTimeFormat("en", {
      hour: "numeric",
      hour12: true,
      minute: "2-digit",
    }).format(new Date(2026, 0, 1, hour, minute));
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeZoneLabel(date: Date) {
  return (
    timeZoneFormatter
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? "Local"
  );
}

const TimelineEvent = memo(function TimelineEvent({
  calendar,
  calendars,
  dayIndex,
  dayMode,
  daySegment,
  dragTimes,
  draggable,
  geometry,
  onBeginDrag,
  pending = false,
  onKeyboardAdjust,
  timeFormat,
  ...eventActions
}: TimelineEventProps) {
  const { col, cols, event } = daySegment;
  const editable = canEditEvent(
    eventActions.getEventMaster(event),
    calendars,
  );
  // While dragging, the block follows the ghost times rather than the data.
  const startMin = dragTimes?.startMinutes ?? daySegment.startMin;
  const endMin = dragTimes?.endMinutes ?? daySegment.endMin;
  const eventColor = calendar?.color ?? event.color;
  const duration = endMin - startMin;

  /**
   * Keyboard equivalent of dragging (docs/ui/calendar-ui.md R10): Alt+Up/Down
   * moves by one snap interval, adding Shift changes the length instead. Without
   * this, direct manipulation would be mouse-only.
   */
  function handleKeyDown(keyEvent: ReactKeyboardEvent<HTMLElement>) {
    if (!draggable || !keyEvent.altKey) return;
    if (keyEvent.key !== "ArrowUp" && keyEvent.key !== "ArrowDown") return;

    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    const step = (keyEvent.key === "ArrowDown" ? 1 : -1) * geometry.snapMinutes;
    const times = nextDragTimes({
      deltaMinutes: step,
      geometry,
      mode: keyEvent.shiftKey ? "resize-end" : "move",
      originEndMinutes: daySegment.endMin,
      originStartMinutes: daySegment.startMin,
    });

    if (
      times.startMinutes === daySegment.startMin &&
      times.endMinutes === daySegment.endMin
    ) {
      return;
    }
    onKeyboardAdjust(event, times);
  }

  function startDrag(
    pointerEvent: ReactPointerEvent<HTMLElement>,
    mode: DragMode,
  ) {
    // Only the primary button, and only where a move is actually allowed.
    if (!draggable || pointerEvent.button !== 0) return;
    onBeginDrag({
      dayIndex,
      endMinutes: daySegment.endMin,
      event,
      mode,
      pointerId: pointerEvent.pointerId,
      startMinutes: daySegment.startMin,
      x: pointerEvent.clientX,
      y: pointerEvent.clientY,
    });
  }
  const left = dayMode ? `${(col / cols) * 100}%` : `${Math.min(col, 3) * 8}px`;
  const width = dayMode
    ? `calc(${100 / cols}% - 3px)`
    : `calc(100% - ${Math.min(col, 3) * 8 + 4}px)`;

  return (
    <EventDetailsPopover
      calendar={calendar}
      calendars={calendars}
      event={event}
      timeFormat={timeFormat}
      {...eventActions}
    >
      <button
        className={styles.timelineEvent}
        type="button"
        aria-label={`${event.title}, ${getEventDateLabel(
          event,
        )}, ${getEventRangeLabel(event, timeFormat)}, ${calendar?.name ?? "calendar"}`}
        aria-busy={pending || undefined}
        data-dragging={dragTimes ? "" : undefined}
        data-draggable={draggable ? "" : undefined}
        data-pending={pending ? "" : undefined}
        data-readonly={editable ? undefined : ""}
        data-time-event={event.id}
        onKeyDown={handleKeyDown}
        onPointerDown={(pointerEvent) => startDrag(pointerEvent, "move")}
        style={
          {
            "--event-color": eventColor,
            "--event-foreground": getReadableEventTextColor(eventColor),
            height: `${Math.max(
              durationToHeight(duration, geometry) - 2,
              geometry.minEventHeight,
            )}px`,
            left,
            top: `${minutesToY(startMin, geometry)}px`,
            width,
            zIndex: col + 1,
          } as CSSProperties
        }
      >
        {/* What fits is the block's own business: the rows below are all
            rendered and the container queries in CSS drop them as the box gets
            shorter. A JS threshold on duration would disagree with the box the
            moment density or zoom changed it. */}
        <span className={styles.timelineEventTime}>
          {/* While dragging, show the time the drop would produce — the
              answer the user is actually looking for. */}
          {dragTimes
            ? `${minuteLabel(startMin, timeFormat)}–${minuteLabel(
                endMin,
                timeFormat,
              )}`
            : getEventRangeLabel(event, timeFormat).replace(" – ", "–")}
        </span>
        <span className={styles.timelineEventTitle}>
          {event.title}
          <EventMarks event={event} readOnly={!editable} />
        </span>
        {event.location ? (
          <span className={styles.timelineEventMeta}>{event.location}</span>
        ) : null}
        {draggable ? (
          <>
            {/* Resize has its own handles and its own state, so a move can
                never be mistaken for a length change. */}
            <span
              aria-hidden="true"
              className={styles.resizeHandleTop}
              onPointerDown={(pointerEvent) => {
                pointerEvent.stopPropagation();
                startDrag(pointerEvent, "resize-start");
              }}
            />
            <span
              aria-hidden="true"
              className={styles.resizeHandleBottom}
              onPointerDown={(pointerEvent) => {
                pointerEvent.stopPropagation();
                startDrag(pointerEvent, "resize-end");
              }}
            />
          </>
        ) : null}
      </button>
    </EventDetailsPopover>
  );
});

export function TimeGridView({
  anchor,
  calendars,
  events,
  geometry,
  onCreateAtTime,
  onMoveEvent,
  busyEventId,
  onMoveDraft,
  pendingCreate,
  showWeekend = true,
  timeFormat,
  view,
  weekStartsOn,
  ...eventActions
}: TimeGridViewProps) {
  const days = useMemo(
    () =>
      getTimeGridDays(anchor, view, weekStartsOn, {
        includeWeekend: showWeekend,
      }),
    [anchor, showWeekend, view, weekStartsOn],
  );
  const eventsByDay = useMemo(() => bucketEventsByDay(events), [events]);
  const segmentsByDay = useMemo(
    () =>
      days.map((day) =>
        getDaySegments(eventsByDay.get(dayKey(day)) ?? [], day),
      ),
    [days, eventsByDay],
  );
  const calendarsById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars],
  );
  const allDaySpans = useMemo(
    () => getAllDaySpans(events, days),
    [days, events],
  );
  const visibleAllDaySpans = allDaySpans.filter(
    (span) => span.lane < ALL_DAY_LANES,
  );
  const hiddenAllDayCount = allDaySpans.length - visibleAllDaySpans.length;
  const allDayLaneCount = Math.min(
    Math.max(...allDaySpans.map((span) => span.lane + 1), 1),
    ALL_DAY_LANES,
  );
  const [now, setNow] = useState(() => new Date());
  const hasToday = days.some((day) => isSameDay(day, now));
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  // Last applied geometry, so a density change can rescale scroll instead of
  // resetting it.
  const geometryRef = useRef(geometry);

  const readColumns = useCallback(() => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    // The time gutter is part of the canvas but is not a day column.
    const gutter = bounds ? Math.min(64, bounds.width) : 0;
    const width = bounds ? (bounds.width - gutter) / days.length : 0;
    return {
      count: days.length,
      left: (bounds?.left ?? 0) + gutter,
      width,
    };
  }, [days.length]);

  const { begin: beginDrag, drag } = useTimeGridDrag({
    columns: readColumns,
    geometry,
    onCommit: async ({ dayOffset, event, times }) => {
      if (!onMoveEvent) return;
      const day = addDays(startOfDay(event.start), dayOffset);
      await onMoveEvent({
        dayOffset,
        end: new Date(day.getTime() + times.endMinutes * 60_000),
        event,
        start: new Date(day.getTime() + times.startMinutes * 60_000),
      });
    },
    onError: eventActions.onNotice,
    scrollRoot: () => rootRef.current?.parentElement,
  });

  /**
   * Apply a keyboard nudge. Announced through the notice live region, because a
   * screen-reader user gets no visual confirmation from the block moving.
   */
  async function adjustByKeyboard(event: Event, times: DragTimes) {
    if (!onMoveEvent) return;
    const day = startOfDay(event.start);
    try {
      await onMoveEvent({
        dayOffset: 0,
        end: new Date(day.getTime() + times.endMinutes * 60_000),
        event,
        start: new Date(day.getTime() + times.startMinutes * 60_000),
      });
      eventActions.onNotice(
        `${event.title} now ${minuteLabel(
          times.startMinutes,
          timeFormat,
        )}–${minuteLabel(times.endMinutes, timeFormat)}.`,
      );
    } catch (error) {
      eventActions.onNotice(
        error instanceof Error
          ? error.message
          : "That change could not be saved. The original time was restored.",
      );
    }
  }

  const {
    begin: beginCreateDrag,
    consumeClick,
    selection: liveSelection,
  } = useDragToCreate({
    geometry,
    onSelected: (dragged, column) => {
      const day = days[dragged.dayIndex];
      if (!day || !onCreateAtTime) return;
      const bounds = column.getBoundingClientRect();
      onCreateAtTime(
        dayKey(day),
        clockValue(dragged.startMinutes),
        {
          returnFocus: column,
          // The column's edge, so the popover lands beside the draft rather
          // than over it.
          x: bounds.right,
          y: bounds.top + minutesToY(dragged.startMinutes, geometry),
        },
        clockValue(dragged.endMinutes),
      );
    },
  });
  // Where the open quick-create popover's slot sits on the grid. This is the
  // draft: a laid-down block, not just a highlight.
  const draftSlot = useMemo(() => {
    if (!pendingCreate?.startTime) return undefined;

    const dayIndex = days.findIndex(
      (day) => dayKey(day) === pendingCreate.date,
    );
    if (dayIndex < 0) return undefined;

    const startMinutes = clockMinutes(pendingCreate.startTime);
    const endMinutes = pendingCreate.endTime
      ? clockMinutes(pendingCreate.endTime)
      : startMinutes + 60;
    return {
      dayIndex,
      endMinutes: Math.max(startMinutes + geometry.snapMinutes, endMinutes),
      startMinutes,
    };
  }, [days, geometry.snapMinutes, pendingCreate]);

  // A second pointer machine, for the draft: same threshold, snapping,
  // auto-scroll and Escape as a real event, but it commits into the open form
  // instead of to the server.
  const { begin: beginDraftDrag, drag: draftDrag } = useTimeGridDrag<undefined>({
    columns: readColumns,
    geometry,
    onCommit: async ({ dayOffset, mode, times }) => {
      if (!draftSlot || !onMoveDraft) return;
      const day = days[
        Math.max(
          0,
          Math.min(
            days.length - 1,
            draftSlot.dayIndex + (mode === "move" ? dayOffset : 0),
          ),
        )
      ];
      if (!day) return;
      onMoveDraft({
        date: dayKey(day),
        endTime: clockValue(times.endMinutes),
        startTime: clockValue(times.startMinutes),
      });
    },
    onError: eventActions.onNotice,
    scrollRoot: () => rootRef.current?.parentElement,
  });
  const dayMode = view === "day";

  // Three sources, in the order they win: the create gesture in progress, the
  // draft being dragged, and the draft at rest. A plain click also produces a
  // draft, so it too shows what "when" it picked.
  const selection = useMemo(() => {
    if (liveSelection) return liveSelection;
    if (draftDrag && draftSlot) {
      return {
        dayIndex:
          draftDrag.mode === "move" ? draftDrag.dayIndex : draftSlot.dayIndex,
        endMinutes: draftDrag.times.endMinutes,
        startMinutes: draftDrag.times.startMinutes,
      };
    }
    return draftSlot;
  }, [draftDrag, draftSlot, liveSelection]);

  /** Grab the draft to move it, or one of its edges to resize it. */
  function startDraftDrag(
    pointerEvent: ReactPointerEvent<HTMLElement>,
    mode: DragMode,
  ) {
    if (!draftSlot || !onMoveDraft || pointerEvent.button !== 0) return;
    pointerEvent.stopPropagation();
    beginDraftDrag({
      dayIndex: draftSlot.dayIndex,
      endMinutes: draftSlot.endMinutes,
      event: undefined,
      mode,
      pointerId: pointerEvent.pointerId,
      startMinutes: draftSlot.startMinutes,
      x: pointerEvent.clientX,
      y: pointerEvent.clientY,
    });
  }

  const layoutStyle = {
    "--day-count": days.length,
    "--all-day-height": `${allDayLaneCount * 24 + 8}px`,
    // The CSS grid derives its height from the same number as the event maths.
    "--hour-height": `${geometry.hourHeight}px`,
  } as CSSProperties;

  // One effect owns where the grid is scrolled.
  //
  // Opening a range anchors near the working day rather than midnight. A density
  // change is different: it rewrites the pixel↔time mapping, so keeping the same
  // scrollTop would silently show a different hour. Then we rescale instead,
  // because the visible *time* is what the user is holding onto.
  useEffect(() => {
    const scrollRoot = rootRef.current?.parentElement;
    const previousHourHeight = geometryRef.current.hourHeight;
    geometryRef.current = geometry;

    if (!scrollRoot) return;

    scrollRoot.scrollTop =
      previousHourHeight === geometry.hourHeight
        ? minutesToY(INITIAL_SCROLL_HOUR * 60, geometry) - 12
        : scrollRoot.scrollTop * (geometry.hourHeight / previousHourHeight);
  }, [anchor, geometry, view, weekStartsOn]);

  useEffect(() => {
    if (!hasToday) {
      return;
    }

    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [hasToday]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }

    const scrollRoot = rootRef.current?.parentElement;

    if (!scrollRoot) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault();
      scrollRoot.scrollBy({
        behavior: "smooth",
        top:
          event.key === "PageDown"
            ? 4 * geometry.hourHeight
            : geometry.hourHeight,
      });
    } else if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      scrollRoot.scrollBy({
        behavior: "smooth",
        top:
          event.key === "PageUp"
            ? -4 * geometry.hourHeight
            : -geometry.hourHeight,
      });
    } else if (event.key === "Home") {
      event.preventDefault();
      scrollRoot.scrollTo({ behavior: "smooth", top: 0 });
    } else if (event.key === "End") {
      event.preventDefault();
      scrollRoot.scrollTo({
        behavior: "smooth",
        top: scrollRoot.scrollHeight,
      });
    }
  }

  return (
    <section
      className={`${styles.timeGridView} ${
        dayMode ? styles.timeGridViewDay : ""
      }`}
      aria-label={`${view === "day" ? "Day" : "Week"} time grid`}
      onKeyDown={handleKeyDown}
      ref={rootRef}
      style={layoutStyle}
      tabIndex={0}
    >
      <div className={styles.timeGridSticky}>
        <div className={styles.timeGridDayHeader}>
          <div aria-hidden="true" />
          {days.map((day) => {
            const today = isSameDay(day, now);

            return (
              <time
                className={today ? styles.timeGridDayToday : ""}
                data-time-grid-day={dayKey(day)}
                dateTime={dayKey(day)}
                key={dayKey(day)}
              >
                <span>
                  {(dayMode
                    ? longWeekdayFormatter
                    : shortWeekdayFormatter
                  ).format(day)}
                </span>
                <strong>{day.getDate()}</strong>
              </time>
            );
          })}
        </div>

        <div className={styles.timeGridAllDay}>
          <span className={styles.timeGridAllDayLabel}>All day</span>
          <div className={styles.timeGridAllDayTrack}>
            {visibleAllDaySpans.map((span) => {
              const calendar = calendarsById.get(span.event.calendars[0] ?? "");
              const eventColor = calendar?.color ?? span.event.color;

              return (
                <EventDetailsPopover
                  calendar={calendar}
                  calendars={calendars}
                  event={span.event}
                  key={span.event.id}
                  timeFormat={timeFormat}
                  {...eventActions}
                >
                  <button
                    className={styles.timeGridAllDayEvent}
                    type="button"
                    aria-label={`All-day event, ${span.event.title}, ${getEventDateLabel(
                      span.event,
                    )}, ${calendar?.name ?? "calendar"}`}
                    data-all-day-event={span.event.id}
                    style={
                      {
                        "--event-color": eventColor,
                        "--event-foreground":
                          getReadableEventTextColor(eventColor),
                        left: `${(span.startCol / days.length) * 100}%`,
                        top: `${span.lane * 24 + 4}px`,
                        width: `${
                          ((span.endCol - span.startCol + 1) / days.length) *
                          100
                        }%`,
                      } as CSSProperties
                    }
                  >
                    {span.event.title}
                  </button>
                </EventDetailsPopover>
              );
            })}
            {hiddenAllDayCount > 0 ? (
              <span className={styles.timeGridAllDayMore}>
                +{hiddenAllDayCount}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.timeGridCanvas} ref={canvasRef}>
        {Array.from({ length: 24 }, (_, hour) => (
          <div
            className={styles.timeGridHour}
            key={hour}
            style={{ top: `${minutesToY(hour * 60, geometry)}px` }}
          >
            {hour > 0 ? <span>{hourLabel(hour, timeFormat)}</span> : null}
          </div>
        ))}
        <span className={styles.timeGridZone} aria-hidden="true">
          {timeZoneLabel(now)}
        </span>
        <div className={styles.timeGridColumns}>
          {days.map((day, dayIndex) => {
            const today = isSameDay(day, now);
            const nowMinutes = now.getHours() * 60 + now.getMinutes();

            return (
              <div
                className={styles.timeGridColumn}
                data-drop-target={
                  drag && drag.mode === "move" && drag.dayIndex === dayIndex
                    ? ""
                    : undefined
                }
                data-time-grid-column={dayKey(day)}
                key={dayKey(day)}
                tabIndex={-1}
                onPointerDown={(pointerEvent) => {
                  if (
                    !onCreateAtTime ||
                    pointerEvent.button !== 0 ||
                    (pointerEvent.target instanceof Element &&
                      pointerEvent.target.closest("button"))
                  ) {
                    return;
                  }
                  beginCreateDrag({
                    clientY: pointerEvent.clientY,
                    column: pointerEvent.currentTarget,
                    dayIndex,
                    pointerId: pointerEvent.pointerId,
                  });
                }}
                onClick={(event) => {
                  if (
                    !onCreateAtTime ||
                    // A drag already answered "when" — don't create twice.
                    consumeClick() ||
                    (event.target instanceof Element &&
                      event.target.closest("button"))
                  ) {
                    return;
                  }

                  const bounds = event.currentTarget.getBoundingClientRect();
                  // Same geometry the grid is drawn with, so the created time is
                  // the time the user pointed at (snapped and clamped there).
                  const minutes = yToMinutes(
                    event.clientY - bounds.top,
                    geometry,
                  );
                  const hour = Math.floor(minutes / 60);
                  const minute = minutes % 60;

                  onCreateAtTime(
                    dayKey(day),
                    `${String(hour).padStart(2, "0")}:${String(minute).padStart(
                      2,
                      "0",
                    )}`,
                    {
                      returnFocus: event.currentTarget,
                      // Beside the column, level with the slot that was clicked
                      // — same rule as a dragged slot.
                      x: event.currentTarget.getBoundingClientRect().right,
                      y: event.clientY,
                    },
                  );
                }}
              >
                {/* The draft: visible from the first pixel of the create
                    gesture, and once laid down it can be moved and resized like
                    a real block. It stays aria-hidden — the popover's own date
                    and time fields are the keyboard path to the same change. */}
                {selection?.dayIndex === dayIndex ? (
                  <div
                    aria-hidden="true"
                    className={styles.timeGridSelection}
                    data-draft={draftSlot && onMoveDraft ? "" : undefined}
                    data-dragging={draftDrag ? "" : undefined}
                    style={{
                      height: `${durationToHeight(
                        selection.endMinutes - selection.startMinutes,
                        geometry,
                      )}px`,
                      top: `${minutesToY(selection.startMinutes, geometry)}px`,
                    }}
                    onPointerDown={(pointerEvent) =>
                      startDraftDrag(pointerEvent, "move")
                    }
                  >
                    <span>
                      {minuteLabel(selection.startMinutes, timeFormat)}–
                      {minuteLabel(selection.endMinutes, timeFormat)}
                    </span>
                    {draftSlot && onMoveDraft ? (
                      <>
                        <span
                          className={styles.resizeHandleTop}
                          onPointerDown={(pointerEvent) =>
                            startDraftDrag(pointerEvent, "resize-start")
                          }
                        />
                        <span
                          className={styles.resizeHandleBottom}
                          onPointerDown={(pointerEvent) =>
                            startDraftDrag(pointerEvent, "resize-end")
                          }
                        />
                      </>
                    ) : null}
                  </div>
                ) : null}
                {segmentsByDay[dayIndex]?.map((segment) => (
                  <TimelineEvent
                    pending={
                      busyEventId !== undefined &&
                      (segment.event.id === busyEventId ||
                        segment.event.id.startsWith(`${busyEventId}_`))
                    }
                    calendar={calendarsById.get(
                      segment.event.calendars[0] ?? "",
                    )}
                    calendars={calendars}
                    dayIndex={dayIndex}
                    dayMode={dayMode}
                    daySegment={segment}
                    dragTimes={
                      // The ghost stays in the event's own column and shows the
                      // new time; the target day is highlighted separately, so a
                      // cross-day drag still reads clearly.
                      drag?.event.id === segment.event.id
                        ? drag.times
                        : undefined
                    }
                    draggable={
                      Boolean(onMoveEvent) &&
                      canEditEvent(
                        eventActions.getEventMaster(segment.event),
                        calendars,
                      )
                    }
                    geometry={geometry}
                    key={segment.event.id}
                    onBeginDrag={beginDrag}
                    onKeyboardAdjust={adjustByKeyboard}
                    timeFormat={timeFormat}
                    {...eventActions}
                  />
                ))}
                {today ? (
                  <div
                    className={styles.timeGridNow}
                    data-current-time
                    style={{
                      top: `${minutesToY(nowMinutes, geometry)}px`,
                    }}
                  >
                    <span />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
