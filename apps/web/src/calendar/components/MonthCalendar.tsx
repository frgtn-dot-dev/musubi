import * as Popover from "@radix-ui/react-popover";
import type { Calendar, Event, Settings } from "@musubi/types";
import {
  getMonthGrid,
  segmentEventsByDay as bucketEventsByDay,
} from "@musubi/calendar/layout";
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getLongDateLabel, getWeekdayLabels } from "../calendar-math";
import { dayDelta, shiftDayKey, toDateKey } from "../date-key";
import { getReadableEventTextColor } from "../event-color";
import { canEditEvent } from "../event-permissions";
import { useDayRangeCreate, useMonthDrag } from "../use-time-grid-drag";
import { EventPopover } from "./EventPopover";
import type { EventActionHandlers } from "./EventDetailsPopover";
import styles from "./workspace.module.css";

const DEFAULT_EVENT_CAPACITY = 3;

function eventCapacityForGrid(grid: HTMLElement) {
  // SSR, jsdom and a temporarily hidden workspace do not have a measurable
  // layout. Keep the established density until a real grid size is available.
  if (grid.clientHeight <= 0) return DEFAULT_EVENT_CAPACITY;

  const styles = window.getComputedStyle(grid);
  const fixedSpace =
    Number.parseFloat(
      styles.getPropertyValue("--month-day-fixed-space"),
    ) || 38;
  const eventHeight =
    Number.parseFloat(styles.getPropertyValue("--month-event-height")) || 21;
  const eventGap =
    Number.parseFloat(styles.getPropertyValue("--month-event-gap")) || 3;
  const rowHeight = grid.clientHeight / 6;
  const availableHeight = Math.max(0, rowHeight - fixedSpace);

  return Math.max(
    1,
    Math.floor((availableHeight + eventGap) / (eventHeight + eventGap)),
  );
}

type MonthCalendarProps = EventActionHandlers & {
  anchor: Date;
  /** The event a write is in flight for, so its chip can say so. */
  busyEventId?: string;
  calendars: Calendar[];
  events: Event[];
  onCreateAtDate?: (
    date: string,
    target: HTMLElement,
    /** Set when days were dragged across: an all-day range. */
    endDate?: string,
  ) => void;
  /** The slot a quick-create popover is open for: the draft, shown as a pill. */
  /** Drops the draft the open quick create describes, before a new one starts. */
  onCancelDraft?: () => void;
  pendingCreate?: { date: string; endDate?: string };
  /**
   * Move the draft to another day range while its popover is open. Absent leaves
   * the draft as a still pill.
   */
  onMoveDraft?: (input: { date: string; endDate: string }) => void;
  onMonthChange: (offset: number) => void;
  /**
   * Move an event to another day, keeping its time. Absent leaves the month
   * read-only for direct manipulation.
   */
  onMoveEventToDate?: (input: {
    dayKey: string;
    event: Event;
  }) => Promise<unknown>;
  /**
   * Page presentation. When false, cells belonging to the neighbouring months
   * render empty — the cell itself stays so the month never changes height.
   */
  showAdjacentDays?: boolean;
  timeFormat: Settings["timeFormat"];
  weekStartsOn: Settings["weekStartsOn"];
};

export function MonthCalendar({
  anchor,
  busyEventId,
  calendars,
  events,
  onCreateAtDate,
  onMonthChange,
  onMoveDraft,
  onMoveEventToDate,
  onCancelDraft,
  pendingCreate,
  showAdjacentDays = true,
  timeFormat,
  weekStartsOn,
  ...eventActions
}: MonthCalendarProps) {
  const {
    begin: beginRangeCreate,
    consumeClick,
    range,
  } = useDayRangeCreate({
    onSelected: ({ fromKey, toKey }, cell) => {
      // Dragging backwards is as valid as forwards.
      const [start, end] =
        fromKey <= toKey ? [fromKey, toKey] : [toKey, fromKey];
      // Anchor on the last day of the range, so the popover opens past the end
      // of the pill rather than across it.
      const endCell = document.querySelector<HTMLElement>(
        `[data-day-key="${end}"]`,
      );
      onCreateAtDate?.(start, endCell ?? cell, end);
    },
  });

  // The draft the open popover describes, as a day range. Dragging it moves the
  // whole range, so the pill is grabbable the way a real chip is.
  const { begin: beginDraftDrag, drag: draftDrag } = useMonthDrag<undefined>({
    onCommit: async ({ dayKey: targetKey, originDayKey }) => {
      if (!pendingCreate || !onMoveDraft) return;
      const shift = dayDelta(originDayKey, targetKey);
      onMoveDraft({
        date: shiftDayKey(pendingCreate.date, shift),
        endDate: shiftDayKey(
          pendingCreate.endDate ?? pendingCreate.date,
          shift,
        ),
      });
    },
    onError: eventActions.onNotice,
  });

  /**
   * The pill's range, whether it is being dragged out right now or already
   * belongs to an open draft.
   *
   * The live drag draws the same pill rather than tinting the cells it crosses:
   * the time grid paints the block you are about to create while you drag it, and
   * a month cell should answer the gesture with the thing it will produce too.
   */
  const draftRange = useMemo(() => {
    if (range) {
      const [first, second] = [range.fromKey, range.toKey];
      return first <= second
        ? { from: first, live: true, to: second }
        : { from: second, live: true, to: first };
    }
    if (!pendingCreate) return undefined;
    // While the pill is being dragged it follows the pointer, before anything
    // is written back to the intent.
    const shift = draftDrag
      ? dayDelta(draftDrag.originDayKey, draftDrag.dayKey)
      : 0;
    const from = shiftDayKey(pendingCreate.date, shift);
    const to = shiftDayKey(pendingCreate.endDate ?? pendingCreate.date, shift);
    return from <= to
      ? { from, live: false, to }
      : { from: to, live: false, to: from };
  }, [draftDrag, pendingCreate, range]);

  const { begin: beginMonthDrag, drag } = useMonthDrag({
    onCommit: async ({ dayKey: targetKey, event }) => {
      await onMoveEventToDate?.({ dayKey: targetKey, event });
    },
    onError: eventActions.onNotice,
  });
  const days = useMemo(
    () => getMonthGrid(anchor, weekStartsOn),
    [anchor, weekStartsOn],
  );
  const weekdayLabels = getWeekdayLabels(weekStartsOn);
  const weeks = useMemo(
    () =>
      Array.from({ length: 6 }, (_, weekIndex) =>
        days.slice(weekIndex * 7, weekIndex * 7 + 7),
      ),
    [days],
  );
  const eventsByDay = useMemo(
    () =>
      bucketEventsByDay(
        events,
        days[0],
        new Date(
          days[days.length - 1]!.getFullYear(),
          days[days.length - 1]!.getMonth(),
          days[days.length - 1]!.getDate() + 1,
        ),
      ),
    [days, events],
  );
  const calendarsById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars],
  );
  const dragPreviewColor = drag
    ? (calendarsById.get(drag.event.calendars[0] ?? "")?.color ??
      drag.event.color)
    : "transparent";
  const todayKey = toDateKey(new Date());
  const initialFocusIndex = Math.max(
    0,
    days.findIndex((day) => toDateKey(day) === toDateKey(anchor)),
  );
  const [focusedIndex, setFocusedIndex] = useState(initialFocusIndex);
  const [eventCapacity, setEventCapacity] = useState(
    DEFAULT_EVENT_CAPACITY,
  );
  const cellRefs = useRef<Array<HTMLDivElement | null>>([]);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === "undefined") return;

    function syncEventCapacity() {
      if (!grid) return;
      const nextCapacity = eventCapacityForGrid(grid);
      setEventCapacity((current) =>
        current === nextCapacity ? current : nextCapacity,
      );
    }

    syncEventCapacity();
    const observer = new ResizeObserver(syncEventCapacity);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  function focusCell(index: number) {
    const bounded = Math.min(days.length - 1, Math.max(0, index));
    setFocusedIndex(bounded);
    requestAnimationFrame(() => cellRefs.current[bounded]?.focus());
  }

  function handleGridKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    index: number,
  ) {
    if (event.target !== event.currentTarget) {
      return;
    }

    const moves: Partial<Record<string, number>> = {
      ArrowDown: 7,
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
    };
    const move = moves[event.key];

    if (move !== undefined) {
      event.preventDefault();
      const next = index + move;

      if (next < 0) {
        onMonthChange(-1);
      } else if (next >= days.length) {
        onMonthChange(1);
      } else {
        focusCell(next);
      }
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusCell(index - (index % 7));
    } else if (event.key === "End") {
      event.preventDefault();
      focusCell(index + (6 - (index % 7)));
    } else if (event.key === "PageUp") {
      event.preventDefault();
      onMonthChange(-1);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      onMonthChange(1);
    } else if (onCreateAtDate && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onCreateAtDate(toDateKey(days[index]!), event.currentTarget);
    }
  }

  return (
    <div
      className={styles.monthView}
      data-event-capacity={eventCapacity}
      role="grid"
      aria-label={`${anchor.toLocaleDateString("en", {
        month: "long",
        year: "numeric",
      })} calendar`}
    >
      <div className={styles.weekdayRow} role="row">
        {weekdayLabels.map((weekday) => (
          <div className={styles.weekday} role="columnheader" key={weekday}>
            {weekday}
          </div>
        ))}
      </div>
      <div className={styles.monthGrid} ref={gridRef} role="rowgroup">
        {weeks.map((week, weekIndex) => (
          <div
            className={styles.monthWeek}
            role="row"
            key={toDateKey(week[0]!)}
          >
            {week.map((day, dayIndex) => {
              const index = weekIndex * 7 + dayIndex;
              const dateKey = toDateKey(day);
              const daySegments = eventsByDay.get(dateKey) ?? [];
              const inMonth = day.getMonth() === anchor.getMonth();
              const isToday = dateKey === todayKey;
              // A hidden adjacent day keeps its cell (so the month keeps its
              // height) but shows nothing and takes no clicks.
              const muted = !inMonth && !showAdjacentDays;
              // If not every event fits, one measured slot belongs to the
              // "+N more" control. This mirrors the calendar pattern where the
              // month grid stays fixed and density yields to explicit overflow.
              const visibleCount =
                daySegments.length > eventCapacity
                  ? Math.max(0, eventCapacity - 1)
                  : eventCapacity;
              const visibleSegments = muted
                ? []
                : daySegments.slice(0, visibleCount);
              const overflow = muted
                ? 0
                : daySegments.length - visibleSegments.length;

              return (
                <div
                  className={`${styles.dayCell} ${
                    inMonth ? "" : styles.dayOutside
                  } ${isToday ? styles.dayToday : ""}`}
                  key={dateKey}
                  ref={(node) => {
                    cellRefs.current[index] = node;
                  }}
                  data-drop-target={
                    drag && drag.dayKey === dateKey ? "" : undefined
                  }
                  onPointerDown={(pointerEvent) => {
                    if (
                      muted ||
                      !onCreateAtDate ||
                      pointerEvent.button !== 0 ||
                      (pointerEvent.target instanceof Element &&
                        pointerEvent.target.closest("button"))
                    ) {
                      return;
                    }
                    // A new gesture replaces the old draft from its first
                    // press, not on release: leaving the previous popover open
                    // over a range being dragged reads as two pending events.
                    onCancelDraft?.();
                    beginRangeCreate({
                      cell: pointerEvent.currentTarget,
                      dayKey: dateKey,
                      pointerId: pointerEvent.pointerId,
                      pointerType: pointerEvent.pointerType,
                      time: pointerEvent.timeStamp,
                      x: pointerEvent.clientX,
                      y: pointerEvent.clientY,
                    });
                  }}
                  role="gridcell"
                  aria-label={
                    muted
                      ? getLongDateLabel(day)
                      : `${getLongDateLabel(day)}, ${daySegments.length} ${
                          daySegments.length === 1 ? "event" : "events"
                        }`
                  }
                  tabIndex={focusedIndex === index ? 0 : -1}
                  data-day-key={dateKey}
                  onClick={(event) => {
                    // A drag already opened quick create for its range.
                    if (muted || consumeClick()) return;
                    onCreateAtDate?.(dateKey, event.currentTarget);
                  }}
                  onFocus={() => setFocusedIndex(index)}
                  onKeyDown={(event) => handleGridKeyDown(event, index)}
                >
                  <div className={styles.dayHeader}>
                    {muted ? null : (
                      <span className={styles.dayNumber}>{day.getDate()}</span>
                    )}
                    {isToday ? (
                      <span className={styles.todayLabel}>Today</span>
                    ) : null}
                  </div>
                  <div className={styles.dayEvents}>
                    {/* The draft, as one pill across the range it covers: a
                        month cell has no time axis, so this reads like the
                        all-day event it will become. Grabbing it moves the whole
                        range. It stays aria-hidden — the popover's own date
                        fields are the keyboard path to the same change. */}
                    {draftRange &&
                    dateKey >= draftRange.from &&
                    dateKey <= draftRange.to ? (
                      <div
                        aria-hidden="true"
                        className={styles.dayDraft}
                        data-continues-after={
                          dateKey < draftRange.to && dayIndex < 6
                            ? ""
                            : undefined
                        }
                        data-continues-before={
                          dateKey > draftRange.from && dayIndex > 0
                            ? ""
                            : undefined
                        }
                        data-draft={
                          !draftRange.live && onMoveDraft ? "" : undefined
                        }
                        data-dragging={draftDrag ? "" : undefined}
                        // Nothing to grab while it is still being dragged out —
                        // the cell under it owns that gesture.
                        data-live={draftRange.live ? "" : undefined}
                        onPointerDown={
                          draftRange.live
                            ? undefined
                            : (pointerEvent) => {
                                if (!onMoveDraft || pointerEvent.button !== 0) {
                                  return;
                                }
                                pointerEvent.stopPropagation();
                                beginDraftDrag({
                                  event: undefined,
                                  originDayKey: dateKey,
                                  pointerId: pointerEvent.pointerId,
                                  x: pointerEvent.clientX,
                                  y: pointerEvent.clientY,
                                });
                              }
                        }
                      >
                        {dateKey === draftRange.from || dayIndex === 0
                          ? "New event"
                          : ""}
                      </div>
                    ) : null}
                    {visibleSegments.map((segment) => (
                      <EventPopover
                        calendar={calendarsById.get(
                          segment.event.calendars[0] ?? "",
                        )}
                        calendars={calendars}
                        continuesAfter={segment.continuesAfter}
                        continuesBefore={segment.continuesBefore}
                        ghost={drag?.event.id === segment.event.id}
                        event={segment.event}
                        pending={
                          busyEventId !== undefined &&
                          (segment.event.id === busyEventId ||
                            segment.event.id.startsWith(`${busyEventId}_`))
                        }
                        key={segment.event.id}
                        onBeginDrag={
                          onMoveEventToDate &&
                          canEditEvent(
                            eventActions.getEventMaster(segment.event),
                            calendars,
                          )
                            ? (pointerEvent) => {
                                if (pointerEvent.button !== 0) return;
                                beginMonthDrag({
                                  event: segment.event,
                                  originDayKey: dateKey,
                                  pointerId: pointerEvent.pointerId,
                                  x: pointerEvent.clientX,
                                  y: pointerEvent.clientY,
                                });
                              }
                            : undefined
                        }
                        showLabel={!segment.continuesBefore || dayIndex === 0}
                        timeFormat={timeFormat}
                        weekStartsOn={weekStartsOn}
                        {...eventActions}
                      />
                    ))}
                    {/* The dragged event, in the cell it would land in: a month
                        cell has no time axis, so "where" is the whole answer and
                        the chip has to be visible to give it. Last in the cell,
                        so multi-day bars already drawn keep their row. */}
                    {drag && drag.dayKey === dateKey ? (
                      <div
                        aria-hidden="true"
                        className={styles.dragPreviewChip}
                        data-drag-preview=""
                        style={
                          {
                            "--event-color": dragPreviewColor,
                            "--event-foreground":
                              getReadableEventTextColor(dragPreviewColor),
                          } as CSSProperties
                        }
                      >
                        {drag.event.title}
                      </div>
                    ) : null}
                    {overflow > 0 ? (
                      <Popover.Root>
                        <Popover.Trigger asChild>
                          <button
                            className={styles.moreEvents}
                            type="button"
                            onClick={(event) => event.stopPropagation()}
                          >
                            +{overflow} more
                          </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                          <Popover.Content
                            align="center"
                            aria-label={`${getLongDateLabel(day)} events`}
                            className={`${styles.popover} ${styles.monthOverflowPopover}`}
                            collisionPadding={12}
                            role="dialog"
                            side="bottom"
                            sideOffset={8}
                          >
                            <div className={styles.monthOverflowHeader}>
                              <h2>{getLongDateLabel(day)}</h2>
                              <p>
                                {daySegments.length}{" "}
                                {daySegments.length === 1
                                  ? "event"
                                  : "events"}
                              </p>
                            </div>
                            <div className={styles.monthOverflowList}>
                              {daySegments.map((segment) => (
                                <EventPopover
                                  calendar={calendarsById.get(
                                    segment.event.calendars[0] ?? "",
                                  )}
                                  calendars={calendars}
                                  event={segment.event}
                                  key={segment.event.id}
                                  pending={
                                    busyEventId !== undefined &&
                                    (segment.event.id === busyEventId ||
                                      segment.event.id.startsWith(
                                        `${busyEventId}_`,
                                      ))
                                  }
                                  showLabel
                                  timeFormat={timeFormat}
                                  weekStartsOn={weekStartsOn}
                                  {...eventActions}
                                />
                              ))}
                            </div>
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover.Root>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
