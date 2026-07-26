import type { Calendar, Event, Settings } from "@musubi/types";
import {
  getMonthGrid,
  segmentEventsByDay as bucketEventsByDay,
} from "@musubi/calendar/layout";
import {
  type KeyboardEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getLongDateLabel,
  getWeekdayLabels,
} from "../calendar-math";
import { toDateKey } from "../date-key";
import { EventPopover } from "./EventPopover";
import styles from "./workspace.module.css";

type MonthCalendarProps = {
  anchor: Date;
  calendars: Calendar[];
  events: Event[];
  onCreateAtDate: (date: string) => void;
  onMonthChange: (offset: number) => void;
  timeFormat: Settings["timeFormat"];
  weekStartsOn: Settings["weekStartsOn"];
};

export function MonthCalendar({
  anchor,
  calendars,
  events,
  onCreateAtDate,
  onMonthChange,
  timeFormat,
  weekStartsOn,
}: MonthCalendarProps) {
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
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onCreateAtDate(toDateKey(days[index]!));
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
              const visibleSegments = daySegments.slice(0, 3);
              const overflow = daySegments.length - visibleSegments.length;

              return (
                <div
                  className={`${styles.dayCell} ${
                    inMonth ? "" : styles.dayOutside
                  } ${isToday ? styles.dayToday : ""}`}
                  key={dateKey}
                  ref={(node) => {
                    cellRefs.current[index] = node;
                  }}
                  role="gridcell"
                  aria-label={`${getLongDateLabel(day)}, ${daySegments.length} ${
                    daySegments.length === 1 ? "event" : "events"
                  }`}
                  tabIndex={focusedIndex === index ? 0 : -1}
                  data-day-key={dateKey}
                  onClick={() => onCreateAtDate(dateKey)}
                  onFocus={() => setFocusedIndex(index)}
                  onKeyDown={(event) => handleGridKeyDown(event, index)}
                >
                  <div className={styles.dayHeader}>
                    <span className={styles.dayNumber}>{day.getDate()}</span>
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
                        continuesAfter={segment.continuesAfter}
                        continuesBefore={segment.continuesBefore}
                        event={segment.event}
                        key={segment.event.id}
                        showLabel={!segment.continuesBefore || dayIndex === 0}
                        timeFormat={timeFormat}
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
