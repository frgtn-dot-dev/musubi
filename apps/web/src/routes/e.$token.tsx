import { expandRecurringEvents } from "@musubi/calendar";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarPlus, MapPin, Repeat2 } from "lucide-react";
import type { PublicEvent } from "~/api/contracts";
import { getPublicEvent } from "~/api/resources";
import { ThemeToggle } from "~/calendar/components/ThemeToggle";
import { BrandMark } from "~/components/BrandMark";
import { RsvpBlock } from "./-rsvp-block";
import { Button } from "~/ui/Button";
import { RouteState } from "~/ui/RouteState";
import styles from "./event-page.module.css";

/** How far ahead a recurring page looks for the occurrence to show. */
const NEXT_OCCURRENCE_WINDOW_MS = 365 * 24 * 60 * 60 * 1_000;

export const Route = createFileRoute("/e/$token")({
  component: PublicEventRoute,
  head: () => ({
    meta: [
      // Nothing is indexable until the page itself says otherwise, and it can
      // only say so after the data has loaded. Starting closed is the only safe
      // default: a crawler that reads the shell must not take silence for yes.
      { content: "noindex, nofollow", name: "robots" },
    ],
  }),
});

/**
 * A published event, for someone with no account here.
 *
 * Deliberately not the app: no sidebar, no session, no data beyond the one
 * projection the API hands out. What it adds is the two things a reader wants —
 * when it is in THEIR timezone, and a way to put it in whatever calendar they
 * actually use.
 */
function PublicEventRoute() {
  const { token } = Route.useParams();
  const page = useQuery({
    queryFn: ({ signal }) => getPublicEvent(token, signal),
    queryKey: ["public-event", token],
    retry: false,
    staleTime: 60_000,
  });

  if (page.isPending) {
    return (
      <RouteState busy eyebrow="Musubi" title="Opening the event…" />
    );
  }

  if (page.isError) {
    return (
      <RouteState
        /* Same reasoning as the missing poll: only the organizer can bring the
           page back, so the way out offered here is the one the reader can take
           without them. */
        actions={
          <Link className={styles.secondaryLink} to="/new-event">
            Make an event page of your own
          </Link>
        }
        description="The link may have been turned off, or the event is no longer there."
        eyebrow="Musubi"
        title="This page is not available."
      />
    );
  }

  const event = page.data;
  const occurrence = nextOccurrence(event);

  return (
    <main
      className={styles.page}
      data-cover={event.theme.cover}
      data-font={event.theme.font}
      data-layout={event.theme.layout}
      id="main-content"
      tabIndex={-1}
    >
      {/* The page follows the reader's system setting and lets them override it,
          like the app and the poll page do. */}
      <div className={styles.themeRow}>
        <ThemeToggle />
      </div>

      {/* The indexing decision travels with the data, not with the route: a page
          shared "anyone with the link" must stay out of search even though the
          markup is identical. */}
      {event.indexable ? (
        <meta content="index, follow" name="robots" />
      ) : null}

      <article className={styles.card}>
        <header className={styles.header}>
          <span aria-hidden="true" className={styles.brand}>
            <BrandMark focusable="false" />
          </span>
          {event.isCanceled ? (
            <p className={styles.cancelled}>Cancelled</p>
          ) : null}
          <h1>{event.title}</h1>
          <p className={styles.organizer}>Organized by {event.organizer}</p>
        </header>

        <dl className={styles.facts}>
          <div>
            <dt>When</dt>
            <dd>
              <time dateTime={occurrence.start.toISOString()}>
                {formatWhen(occurrence.start, occurrence.end, event.isAllDay)}
              </time>
              {/* Spelled out, because the reader is somewhere else than the
                  organizer often enough that "3pm" alone is a trap. */}
              <span className={styles.timezone}>{localTimezoneLabel()}</span>
              {event.recurrence ? (
                <span className={styles.repeats}>
                  <Repeat2 aria-hidden="true" size={13} /> Repeats
                </span>
              ) : null}
            </dd>
          </div>
          {event.location ? (
            <div>
              <dt>Where</dt>
              <dd>
                <MapPin aria-hidden="true" size={14} strokeWidth={1.7} />
                {event.location}
              </dd>
            </div>
          ) : null}
          {event.url ? (
            <div>
              <dt>Link</dt>
              <dd>
                <a href={event.url} rel="noopener noreferrer nofollow" target="_blank">
                  {event.url}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>

        {event.description ? (
          <p className={styles.description}>{event.description}</p>
        ) : null}

        {/* Only where somebody can be told: a server with no mail cannot send a
            code, so the block would be a dead end (PRD §18.2). */}
        {event.isCanceled ? null : <RsvpBlock token={token} />}

        <div className={styles.actions}>
          <Button
            icon={<CalendarPlus size={16} strokeWidth={1.6} />}
            onClick={() => downloadIcs(event, occurrence)}
          >
            Add to calendar
          </Button>
          <a
            className={styles.secondaryLink}
            href={googleCalendarUrl(event, occurrence)}
            rel="noopener noreferrer"
            target="_blank"
          >
            Google Calendar
          </a>
        </div>
      </article>

      <p className={styles.footer}>
        Published with <a href="https://musubi.pro">Musubi</a>
      </p>
    </main>
  );
}

type Occurrence = { end: Date; start: Date };

/**
 * Which instance the page is about.
 *
 * Expanded HERE, in the reader's timezone: recurrence is wall-clock, so a server
 * doing this would answer in its own zone and be an hour out for half the year.
 */
function nextOccurrence(event: PublicEvent): Occurrence {
  if (!event.recurrence) return { end: event.end, start: event.start };

  const now = new Date();
  const [next] = expandRecurringEvents(
    [
      {
        end: event.end,
        id: "shared",
        isAllDay: event.isAllDay,
        recurrence: event.recurrence,
        start: event.start,
        title: event.title,
      },
    ],
    now,
    new Date(now.getTime() + NEXT_OCCURRENCE_WINDOW_MS),
  );

  // A series whose occurrences are all behind us still has to render something
  // true, so it falls back to its own times.
  return next ? { end: next.end, start: next.start } : { end: event.end, start: event.start };
}

function localTimezoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

function formatWhen(start: Date, end: Date, allDay: boolean): string {
  const date = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  }).format(start);

  if (allDay) return date;

  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${date}, ${time.format(start)} – ${time.format(end)}`;
}

/** iCal stamps are UTC, seconds precision, no punctuation. */
function icsStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * One event, as a file every calendar app understands.
 *
 * Built in the browser rather than fetched: the data is already here, and it
 * keeps the public API to a single read. Only this occurrence — a stranger is
 * being invited to one thing, not subscribing to a series.
 */
function downloadIcs(event: PublicEvent, occurrence: Occurrence) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Musubi//Event page//EN",
    "BEGIN:VEVENT",
    `UID:${icsStamp(occurrence.start)}-musubi@${window.location.host}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(occurrence.start)}`,
    `DTEND:${icsStamp(occurrence.end)}`,
    `SUMMARY:${icsEscape(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${icsEscape(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${icsEscape(event.location)}`] : []),
    ...(event.isCanceled ? ["STATUS:CANCELLED"] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  const blob = new Blob([`${lines.join("\r\n")}\r\n`], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = `${event.title.replace(/[^\w -]/g, "").trim() || "event"}.ics`;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
}

function googleCalendarUrl(event: PublicEvent, occurrence: Occurrence): string {
  const query = new URLSearchParams({
    action: "TEMPLATE",
    dates: `${icsStamp(occurrence.start)}/${icsStamp(occurrence.end)}`,
    text: event.title,
    ...(event.description ? { details: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
  });

  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}
