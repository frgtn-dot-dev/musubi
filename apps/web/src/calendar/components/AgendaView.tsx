import type { Calendar, Event, Settings } from "@musubi/types";
import { ChevronRight } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AGENDA_GROUP_PAGE,
  getAgendaGroups,
  getAgendaLabel,
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
  const groups = useMemo(
    () => getAgendaGroups(events, anchor),
    [anchor, events],
  );
  const calendarsById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars],
  );
  const groupFingerprint = useMemo(
    () =>
      `${anchor.getTime()}:${events.map((event) => event.id).join("|")}`,
    [anchor, events],
  );
  const [pagination, setPagination] = useState({
    fingerprint: groupFingerprint,
    shown: AGENDA_GROUP_PAGE,
  });
  const shown =
    pagination.fingerprint === groupFingerprint
      ? pagination.shown
      : AGENDA_GROUP_PAGE;
  const rootRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const visibleGroups = groups.slice(0, shown);
  const todayKey = toDateKey(new Date());

  useEffect(() => {
    const scrollRoot = rootRef.current?.parentElement;

    if (scrollRoot && typeof scrollRoot.scrollTo === "function") {
      scrollRoot.scrollTo({ behavior: "auto", top: 0 });
    }
  }, [groupFingerprint]);

  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (
      !sentinel ||
      shown >= groups.length ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setPagination((current) => ({
            fingerprint: groupFingerprint,
            shown: Math.min(
              (current.fingerprint === groupFingerprint
                ? current.shown
                : AGENDA_GROUP_PAGE) + AGENDA_GROUP_PAGE,
              groups.length,
            ),
          }));
        }
      },
      {
        root: rootRef.current?.parentElement ?? null,
        rootMargin: "0px",
      },
    );
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [groupFingerprint, groups.length, shown]);

  return (
    <section
      className={styles.agendaView}
      aria-label={`${getAgendaLabel(anchor)} agenda`}
      ref={rootRef}
    >
      <ol className={styles.agendaList}>
        {visibleGroups.map((group, groupIndex) => {
          const isNewYear =
            groupIndex === 0 ||
            visibleGroups[groupIndex - 1]?.date.getFullYear() !==
              group.date.getFullYear();
          const isToday = group.key === todayKey;

          return (
            <Fragment key={group.key}>
              {isNewYear ? (
                <li className={styles.agendaYear} aria-hidden="true">
                  <span>{group.date.getFullYear()}</span>
                </li>
              ) : null}
              <li
                className={`${styles.agendaDay} ${
                  isToday ? styles.agendaDayToday : ""
                }`}
                data-agenda-date={group.key}
              >
                <time className={styles.agendaDate} dateTime={group.key}>
                  {dayFormatter.format(group.date)}
                </time>
                <div className={styles.agendaEvents}>
                  {group.items.map((event) => {
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
              </li>
            </Fragment>
          );
        })}
      </ol>
      {shown < groups.length ? (
        <div
          className={styles.agendaSentinel}
          data-agenda-sentinel
          ref={sentinelRef}
          role="status"
          aria-label="Loading more events"
        />
      ) : null}
    </section>
  );
}
