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
  getTimeGridDays,
  type TimeGridViewId,
} from "../time-grid-math";
import { EventDetailsPopover } from "./EventDetailsPopover";
import styles from "./workspace.module.css";

const HOUR_HEIGHT = 64;
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

type TimeGridViewProps = {
  anchor: Date;
  calendars: Calendar[];
  events: Event[];
  timeFormat: Settings["timeFormat"];
  view: TimeGridViewId;
  weekStartsOn: Settings["weekStartsOn"];
};

type TimelineEventProps = {
  calendar: Calendar | undefined;
  dayMode: boolean;
  daySegment: ReturnType<typeof getDaySegments<Event>>[number];
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
  dayMode,
  daySegment,
  timeFormat,
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
      event={event}
      timeFormat={timeFormat}
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
            height: `${Math.max((duration / 60) * HOUR_HEIGHT - 2, 20)}px`,
            left,
            top: `${(startMin / 60) * HOUR_HEIGHT}px`,
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
  timeFormat,
  view,
  weekStartsOn,
}: TimeGridViewProps) {
  const days = useMemo(
    () => getTimeGridDays(anchor, view, weekStartsOn),
    [anchor, view, weekStartsOn],
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
  const dayMode = view === "day";
  const layoutStyle = {
    "--day-count": days.length,
    "--all-day-height": `${allDayLaneCount * 24 + 8}px`,
  } as CSSProperties;

  useEffect(() => {
    const scrollRoot = rootRef.current?.parentElement;

    if (scrollRoot) {
      scrollRoot.scrollTop =
        INITIAL_SCROLL_HOUR * HOUR_HEIGHT - 12;
    }
  }, [anchor, view, weekStartsOn]);

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
        top: event.key === "PageDown" ? 4 * HOUR_HEIGHT : HOUR_HEIGHT,
      });
    } else if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      scrollRoot.scrollBy({
        behavior: "smooth",
        top: event.key === "PageUp" ? -4 * HOUR_HEIGHT : -HOUR_HEIGHT,
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
                  event={span.event}
                  key={span.event.id}
                  timeFormat={timeFormat}
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
            style={{ top: `${hour * HOUR_HEIGHT}px` }}
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
              >
                {segmentsByDay[dayIndex]?.map((segment) => (
                  <TimelineEvent
                    calendar={calendarsById.get(
                      segment.event.calendars[0] ?? "",
                    )}
                    dayMode={dayMode}
                    daySegment={segment}
                    key={segment.event.id}
                    timeFormat={timeFormat}
                  />
                ))}
                {today ? (
                  <div
                    className={styles.timeGridNow}
                    data-current-time
                    style={{
                      top: `${(nowMinutes / 60) * HOUR_HEIGHT}px`,
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
