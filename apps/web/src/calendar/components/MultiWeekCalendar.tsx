import { bucketEventsByDay, getDaySegments } from "@musubi/calendar/layout";
import type { Calendar, Event, Settings } from "@musubi/types";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { calendarLaneSpans, visibleLaneLimit } from "../all-day-lanes";
import { getEventDateLabel, getEventRangeLabel } from "../calendar-math";
import { toDateKey } from "../date-key";
import { Popover, PopoverContent, PopoverTrigger } from "~/ui/Popover";

import { overlapPlacement } from "../time-grid-math";
import type { EventActionHandlers } from "./EventDetailsPopover";
import { EventDetailsPopover } from "./EventDetailsPopover";
import { EventPopover } from "./EventPopover";
import styles from "./workspace.module.css";

// ── Matrix tuning ────────────────────────────────────────────────────────────
/**
 * Narrowest a week block may get before its seven day columns stop being
 * readable. The matrix fits as many columns as this allows and wraps the rest
 * into rows — which is what "automatic matrix by viewport" means in practice.
 */
const MIN_BLOCK_WIDTH_PX = 260;
const MULTI_WEEK_EVENT_CAPACITY = 3;
/**
 * The hours a block shows. Its minimum height lives in CSS (`.weekBlock`). A full day squeezed into 190px is a smear; a working
 * window is what makes twenty weeks comparable at a glance. Page-configurable
 * later (`PRD §16.1`), one constant for now so every block shares a scale.
 */
const VISIBLE_START_HOUR = 7;
const VISIBLE_END_HOUR = 21;

const VISIBLE_MINUTES = (VISIBLE_END_HOUR - VISIBLE_START_HOUR) * 60;

type MultiWeekCalendarProps = EventActionHandlers & {
  busyEventId?: string;
  calendars: Calendar[];
  events: Event[];
  /** Whole weeks, in order. Each block is one of them. */
  weeks: Date[][];
  timeFormat: Settings["timeFormat"];
  weekStartsOn: Settings["weekStartsOn"];
};

/**
 * Weeks side by side and stacked — the long view.
 *
 * Deliberately NOT the interactive time grid: twenty live grids would each carry
 * drag, resize, hit-testing and a now-marker, and the point of this view is to
 * read many weeks at once. So it reuses the same layout maths (`getDaySegments`,
 * `assignOverlapColumns` via the package, `overlapPlacement`) and renders blocks
 * that answer "how full is that week" — clicking an event still opens the same
 * popover as everywhere else.
 */
export function MultiWeekCalendar({
  busyEventId,
  calendars,
  events,
  timeFormat,
  weeks,
  weekStartsOn,
  ...eventActions
}: MultiWeekCalendarProps) {
  const [columns, setColumns] = useState(1);
  const frameRef = useRef<HTMLDivElement>(null);
  const todayKey = toDateKey(new Date());

  // The matrix follows the viewport: as many columns as fit at a readable
  // width, the rest wrap. A page asking for eight weeks gets 4×2 on a laptop
  // and 1×8 on a phone without either being configured.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;

    function measure() {
      if (!frame) return;
      const fit = Math.max(
        1,
        Math.floor(frame.clientWidth / MIN_BLOCK_WIDTH_PX),
      );
      const next = Math.min(fit, weeks.length);
      setColumns((current) => (current === next ? current : next));
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [weeks.length]);

  // Plain per-day buckets: a block draws timed events in their own day column,
  // so the month view's continuation metadata would be noise here.
  const byDay = useMemo(() => bucketEventsByDay(events), [events]);

  return (
    <div
      className={styles.multiWeek}
      ref={frameRef}
      style={{ "--multi-week-columns": columns } as CSSProperties}
    >
      {weeks.map((week) => (
        <WeekBlock
          busyEventId={busyEventId}
          calendars={calendars}
          days={week}
          eventsByDay={byDay}
          key={toDateKey(week[0]!)}
          timeFormat={timeFormat}
          todayKey={todayKey}
          weekStartsOn={weekStartsOn}
          {...eventActions}
        />
      ))}
    </div>
  );
}

function WeekBlock({
  busyEventId,
  calendars,
  days,
  eventsByDay,
  timeFormat,
  todayKey,
  weekStartsOn,
  ...eventActions
}: EventActionHandlers & {
  busyEventId?: string;
  calendars: Calendar[];
  days: Date[];
  eventsByDay: Map<string, Event[]>;
  timeFormat: Settings["timeFormat"];
  todayKey: string;
  weekStartsOn: Settings["weekStartsOn"];
}) {
  const first = days[0]!;
  const weekEvents = [
    ...new Map(
      days.flatMap((day) =>
        (eventsByDay.get(toDateKey(day)) ?? []).map((event) => [
          event.id,
          event,
        ]),
      ),
    ).values(),
  ];
  const laneSpans = calendarLaneSpans(weekEvents, days);
  const laneCount = Math.max(0, ...laneSpans.map((span) => span.lane + 1));
  const visibleLaneCount = visibleLaneLimit(
    laneCount,
    MULTI_WEEK_EVENT_CAPACITY,
  );

  return (
    <section
      aria-label={`Week of ${first.toLocaleDateString("en", {
        day: "numeric",
        month: "long",
      })}`}
      className={styles.weekBlock}
    >
      <header className={styles.weekBlockHeader}>
        {days.map((day) => {
          const dayKey = toDateKey(day);

          return (
            <div
              className={styles.weekBlockDay}
              data-today={dayKey === todayKey ? "" : undefined}
              key={dayKey}
            >
              {/* The month rides on the first of it, so a block that crosses a
                  boundary says so without a caption of its own — and it takes
                  the weekday letter's place rather than making the row taller. */}
              {day.getDate() === 1 ? null : (
                <span className={styles.weekBlockWeekday}>
                  {day.toLocaleDateString("en", { weekday: "narrow" })}
                </span>
              )}
              <span className={styles.weekBlockDate}>
                {day.getDate() === 1
                  ? day.toLocaleDateString("en", {
                      day: "numeric",
                      month: "short",
                    })
                  : day.getDate()}
              </span>
            </div>
          );
        })}
      </header>

      <div className={styles.weekBlockGrid} role="presentation">
        {days.map((day, dayIndex) => {
          const dayKey = toDateKey(day);
          // Same segmentation and overlap columns as the real week grid, so a
          // busy Tuesday looks busy in both.
          const segments = getDaySegments(eventsByDay.get(dayKey) ?? [], day);
          const dayLaneSpans = laneSpans.filter(
            (span) => span.startCol <= dayIndex && span.endCol >= dayIndex,
          );
          const visibleLaneSpans = dayLaneSpans.filter(
            (span) => span.lane < visibleLaneCount,
          );
          const hiddenLaneSpans = dayLaneSpans.filter(
            (span) => span.lane >= visibleLaneCount,
          );

          return (
            <div
              className={styles.weekBlockColumn}
              data-today={dayKey === todayKey ? "" : undefined}
              key={dayKey}
            >
              {visibleLaneSpans.map((span) => (
                <BlockEvent
                  allDay
                  busyEventId={busyEventId}
                  calendars={calendars}
                  event={span.event}
                  key={`${span.id}:${dayKey}`}
                  placement={{ left: "0%", width: "calc(100% - 2px)" }}
                  style={{ top: `${1 + span.lane * 12}px` }}
                  timeFormat={timeFormat}
                  weekStartsOn={weekStartsOn}
                  {...eventActions}
                />
              ))}
              {hiddenLaneSpans.length > 0 ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      aria-label={`${hiddenLaneSpans.length} more all-day ${
                        hiddenLaneSpans.length === 1 ? "item" : "items"
                      } on ${day.toLocaleDateString("en", {
                        day: "numeric",
                        month: "long",
                      })}`}
                      className={styles.weekBlockMore}
                      style={{ top: `${1 + visibleLaneCount * 12}px` }}
                      type="button"
                    >
                      +{hiddenLaneSpans.length}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="center"
                    aria-label={`${day.toLocaleDateString("en", {
                      day: "numeric",
                      month: "long",
                    })} hidden all-day items`}
                    className={styles.monthOverflowPopover}
                    collisionPadding={12}
                    role="dialog"
                    side="bottom"
                    sideOffset={8}
                  >
                    <div className={styles.monthOverflowList}>
                      {hiddenLaneSpans.flatMap((span) => {
                        return [
                          <EventPopover
                            calendar={calendars.find((calendar) =>
                              span.event.calendars.includes(calendar.id),
                            )}
                            calendars={calendars}
                            event={span.event}
                            key={span.id}
                            showLabel
                            timeFormat={timeFormat}
                            weekStartsOn={weekStartsOn}
                            {...eventActions}
                          />,
                        ];
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : null}
              {segments.map((segment) => {
                // Clipped to the visible window rather than dropped: an event
                // that starts at 06:00 still has to be visible at the top edge,
                // or the block quietly lies about how full the day is.
                const top = Math.max(
                  0,
                  segment.startMin - VISIBLE_START_HOUR * 60,
                );
                const bottom = Math.min(
                  VISIBLE_MINUTES,
                  segment.endMin - VISIBLE_START_HOUR * 60,
                );
                if (bottom <= 0 || top >= VISIBLE_MINUTES) return null;

                return (
                  <BlockEvent
                    busyEventId={busyEventId}
                    calendars={calendars}
                    event={segment.event}
                    key={`${segment.event.id}-${segment.startMin}`}
                    placement={overlapPlacement(segment.col, segment.cols)}
                    style={{
                      height: `${((bottom - top) / VISIBLE_MINUTES) * 100}%`,
                      top: `${(top / VISIBLE_MINUTES) * 100}%`,
                    }}
                    timeFormat={timeFormat}
                    weekStartsOn={weekStartsOn}
                    {...eventActions}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BlockEvent({
  allDay,
  busyEventId,
  calendars,
  event,
  placement,
  style,
  timeFormat,
  weekStartsOn,
  ...eventActions
}: EventActionHandlers & {
  allDay?: boolean;
  busyEventId?: string;
  calendars: Calendar[];
  event: Event;
  placement: { left: string; width: string };
  style?: CSSProperties;
  timeFormat: Settings["timeFormat"];
  weekStartsOn: Settings["weekStartsOn"];
}) {
  const calendar = calendars.find((item) => event.calendars.includes(item.id));

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
        aria-busy={busyEventId === event.id || undefined}
        aria-label={`${event.title}, ${getEventDateLabel(event)}, ${getEventRangeLabel(
          event,
          timeFormat,
        )}, ${calendar?.name ?? "calendar"}`}
        className={allDay ? styles.weekBlockAllDay : styles.weekBlockEvent}
        style={
          {
            ...style,
            "--event-color": calendar?.color,
            left: placement.left,
            width: placement.width,
          } as CSSProperties
        }
        type="button"
      >
        <span>{event.title}</span>
      </button>
    </EventDetailsPopover>
  );
}
