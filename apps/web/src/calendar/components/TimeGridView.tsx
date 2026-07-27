import type { Calendar, Event, Settings } from "@musubi/types";
import {
  bucketEventsByDay,
  dayKey,
  getAllDaySpans,
  getDaySegments,
  isSameDay,
} from "@musubi/calendar/layout";
import {
  type CSSProperties,
  type KeyboardEvent,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getEventDateLabel,
  getEventRangeLabel,
} from "../calendar-math";
import { getReadableEventTextColor } from "../event-color";
import {
  durationToHeight,
  minutesToY,
  yToMinutes,
  type TimeGeometry,
} from "../time-geometry";
import {
  getTimeGridDays,
  type TimeGridViewId,
} from "../time-grid-math";
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
  calendars: Calendar[];
  events: Event[];
  geometry: TimeGeometry;
  /** Page presentation: a five-column working week when false. */
  showWeekend?: boolean;
  onCreateAtTime?: (
    date: string,
    time: string,
    anchor: { returnFocus: HTMLElement; x: number; y: number },
  ) => void;
  timeFormat: Settings["timeFormat"];
  view: TimeGridViewId;
  weekStartsOn: Settings["weekStartsOn"];
};

type TimelineEventProps = EventActionHandlers & {
  calendar: Calendar | undefined;
  calendars: Calendar[];
  dayMode: boolean;
  daySegment: ReturnType<typeof getDaySegments<Event>>[number];
  geometry: TimeGeometry;
  timeFormat: Settings["timeFormat"];
};

function hourLabel(hour: number, timeFormat: Settings["timeFormat"]) {
  if (timeFormat === "24h") {
    return `${String(hour).padStart(2, "0")}:00`;
  }

  return hour12Formatter.format(new Date(2026, 0, 1, hour));
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
  dayMode,
  daySegment,
  geometry,
  timeFormat,
  ...eventActions
}: TimelineEventProps) {
  const { col, cols, endMin, event, startMin } = daySegment;
  const eventColor = calendar?.color ?? event.color;
  const duration = endMin - startMin;
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
        data-time-event={event.id}
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
        {duration >= 30 ? (
          <span className={styles.timelineEventTime}>
            {getEventRangeLabel(event, timeFormat).replace(" – ", "–")}
          </span>
        ) : null}
        <span className={styles.timelineEventTitle}>{event.title}</span>
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
  const hiddenAllDayCount =
    allDaySpans.length - visibleAllDaySpans.length;
  const allDayLaneCount = Math.min(
    Math.max(...allDaySpans.map((span) => span.lane + 1), 1),
    ALL_DAY_LANES,
  );
  const [now, setNow] = useState(() => new Date());
  const hasToday = days.some((day) => isSameDay(day, now));
  const rootRef = useRef<HTMLElement>(null);
  // Last applied geometry, so a density change can rescale scroll instead of
  // resetting it.
  const geometryRef = useRef(geometry);
  const dayMode = view === "day";
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
              const calendar = calendarsById.get(
                span.event.calendars[0] ?? "",
              );
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
                          ((span.endCol - span.startCol + 1) /
                            days.length) *
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

      <div className={styles.timeGridCanvas}>
        {Array.from({ length: 24 }, (_, hour) => (
          <div
            className={styles.timeGridHour}
            key={hour}
            style={{ top: `${minutesToY(hour * 60, geometry)}px` }}
          >
            {hour > 0 ? (
              <span>{hourLabel(hour, timeFormat)}</span>
            ) : null}
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
                data-time-grid-column={dayKey(day)}
                key={dayKey(day)}
                tabIndex={-1}
                onClick={(event) => {
                  if (
                    !onCreateAtTime ||
                    event.target instanceof Element &&
                      event.target.closest("button")
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
                    `${String(hour).padStart(2, "0")}:${String(
                      minute,
                    ).padStart(2, "0")}`,
                    {
                      returnFocus: event.currentTarget,
                      x: event.clientX,
                      y: event.clientY,
                    },
                  );
                }}
              >
                {segmentsByDay[dayIndex]?.map((segment) => (
                  <TimelineEvent
                    calendar={calendarsById.get(
                      segment.event.calendars[0] ?? "",
                    )}
                    calendars={calendars}
                    dayMode={dayMode}
                    daySegment={segment}
                    geometry={geometry}
                    key={segment.event.id}
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
