import type { Calendar, Event, Settings } from "@musubi/types";
import { dayKey } from "@musubi/calendar/layout";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import {
  getAgendaDays,
  getAgendaEventsByDay,
  getAgendaRange,
  getAgendaRangeLabel,
} from "../agenda-math";
import {
  getEventDateLabel,
  getEventRangeLabel,
} from "../calendar-math";
import { toDateKey } from "../date-key";
import { EventDetailsPopover } from "./EventDetailsPopover";
import styles from "./workspace.module.css";

type AgendaViewProps = {
  anchor: Date;
  calendars: Calendar[];
  events: Event[];
  timeFormat: Settings["timeFormat"];
};

const dayFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  weekday: "long",
});

export function AgendaView({
  anchor,
  calendars,
  events,
  timeFormat,
}: AgendaViewProps) {
  const range = useMemo(() => getAgendaRange(anchor), [anchor]);
  const days = useMemo(
    () => getAgendaDays(range.start, range.end),
    [range.end, range.start],
  );
  const eventsByDay = useMemo(
    () => getAgendaEventsByDay(events, range.start, range.end),
    [events, range.end, range.start],
  );
  const calendarsById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars],
  );
  const todayKey = toDateKey(new Date());

  return (
    <section
      className={styles.agendaView}
      aria-label={`${getAgendaRangeLabel(range.start, range.end)} agenda`}
    >
      <ol className={styles.agendaList}>
        {days.map((day) => {
          const dateKey = dayKey(day);
          const dayEvents = eventsByDay.get(dateKey) ?? [];

          return (
            <li
              className={`${styles.agendaDay} ${
                dateKey === todayKey ? styles.agendaDayToday : ""
              }`}
              data-agenda-date={dateKey}
              key={dateKey}
            >
              <time className={styles.agendaDate} dateTime={dateKey}>
                {dayFormatter.format(day)}
              </time>
              {dayEvents.length > 0 ? (
                <div className={styles.agendaEvents}>
                  {dayEvents.map((event) => {
                    const calendar = calendarsById.get(
                      event.calendars[0] ?? "",
                    );
                    const eventColor = calendar?.color ?? event.color;
                    const rangeLabel = getEventRangeLabel(
                      event,
                      timeFormat,
                    ).replace(" – ", "–");

                    return (
                      <EventDetailsPopover
                        calendar={calendar}
                        event={event}
                        key={event.id}
                        timeFormat={timeFormat}
                      >
                        <button
                          className={styles.agendaEvent}
                          type="button"
                          aria-label={`${event.title}, ${getEventDateLabel(
                            event,
                          )}, ${getEventRangeLabel(
                            event,
                            timeFormat,
                          )}, ${calendar?.name ?? "calendar"}`}
                          data-agenda-event={event.id}
                        >
                          <span className={styles.agendaEventTime}>
                            {rangeLabel}
                          </span>
                          <span
                            className={styles.agendaEventRule}
                            style={{ backgroundColor: eventColor }}
                          />
                          <span className={styles.agendaEventTitle}>
                            {event.title}
                          </span>
                          <span className={styles.agendaEventCalendar}>
                            {calendar?.name ?? "Calendar"}
                          </span>
                          <ChevronRight
                            className={styles.agendaEventChevron}
                            aria-hidden="true"
                            size={14}
                            strokeWidth={1.4}
                          />
                        </button>
                      </EventDetailsPopover>
                    );
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
