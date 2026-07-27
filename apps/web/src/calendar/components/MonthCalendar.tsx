import type { Calendar, Event, Settings } from "@musubi/types";
import {
  getMonthGrid,
  segmentEventsByDay as bucketEventsByDay,
} from "@musubi/calendar/layout";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { getLongDateLabel, getWeekdayLabels } from "../calendar-math";
import { toDateKey } from "../date-key";
import { canEditEvent } from "../event-permissions";
import { useDayRangeCreate, useMonthDrag } from "../use-time-grid-drag";
import { EventPopover } from "./EventPopover";
import type { EventActionHandlers } from "./EventDetailsPopover";
import styles from "./workspace.module.css";

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
  /** The slot a quick-create popover is open for, so its days stay highlighted. */
  pendingCreate?: { date: string; endDate?: string };
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
  onMoveEventToDate,
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
      onCreateAtDate?.(start, cell, end);
    },
  });

  // Highlight the dragged days, and keep them highlighted while the popover the
  // drag opened is still up.
  const selectedRange = useMemo(() => {
    const source = range
      ? [range.fromKey, range.toKey]
      : pendingCreate?.endDate && pendingCreate.endDate !== pendingCreate.date
        ? [pendingCreate.date, pendingCreate.endDate]
        : undefined;
    if (!source) return undefined;
    const [first, second] = source as [string, string];
    return first <= second
      ? { from: first, to: second }
      : { from: second, to: first };
  }, [pendingCreate, range]);

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
  const todayKey = toDateKey(new Date());
  const initialFocusIndex = Math.max(
    0,
    days.findIndex((day) => toDateKey(day) === toDateKey(anchor)),
  );
  const [focusedIndex, setFocusedIndex] = useState(initialFocusIndex);
  const cellRefs = useRef<Array<HTMLDivElement | null>>([]);

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
      <div className={styles.monthGrid} role="rowgroup">
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
              const visibleSegments = muted ? [] : daySegments.slice(0, 3);
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
                  data-range-selected={
                    selectedRange &&
                    dateKey >= selectedRange.from &&
                    dateKey <= selectedRange.to
                      ? ""
                      : undefined
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
                    beginRangeCreate({
                      cell: pointerEvent.currentTarget,
                      dayKey: dateKey,
                      pointerId: pointerEvent.pointerId,
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
                    {visibleSegments.map((segment) => (
                      <EventPopover
                        calendar={calendarsById.get(
                          segment.event.calendars[0] ?? "",
                        )}
                        calendars={calendars}
                        continuesAfter={segment.continuesAfter}
                        continuesBefore={segment.continuesBefore}
                        dragging={drag?.event.id === segment.event.id}
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
                        {...eventActions}
                      />
                    ))}
                    {overflow > 0 ? (
                      <button
                        className={styles.moreEvents}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          focusCell(index);
                        }}
                      >
                        +{overflow} more
                      </button>
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
