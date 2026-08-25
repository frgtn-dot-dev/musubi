import { expandRecurringEvents } from "@musubi/calendar";
import {
  eventPagePalette,
  eventPagePaletteVariables,
} from "@musubi/design-system";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarPlus,
  Clock3,
  ExternalLink,
  Link as LinkIcon,
  MapPin,
  Repeat2,
  Share2,
} from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { PublicEvent } from "~/api/contracts";
import { getPublicEvent } from "~/api/resources";
import { BrandMark } from "~/components/BrandMark";
import { Avatar } from "~/ui/Avatar";
import { Button } from "~/ui/Button";
import { RouteState } from "~/ui/RouteState";
import { RsvpBlock } from "./-rsvp-block";
import styles from "./event-page.module.css";

const NEXT_OCCURRENCE_WINDOW_MS = 365 * 24 * 60 * 60 * 1_000;

export const Route = createFileRoute("/e/$token")({
  component: PublicEventRoute,
  head: () => ({
    meta: [{ content: "noindex, nofollow", name: "robots" }],
  }),
});

function PublicEventRoute() {
  const { token } = Route.useParams();
  const [copied, setCopied] = useState(false);
  const page = useQuery({
    queryFn: ({ signal }) => getPublicEvent(token, signal),
    queryKey: ["public-event", token],
    retry: false,
    staleTime: 60_000,
  });

  if (page.isPending) {
    return <RouteState busy eyebrow="Musubi" title="Opening the event…" />;
  }

  if (page.isError) {
    return (
      <RouteState
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
  const palette = eventPagePalette(event.theme.palette);
  const pageStyle = eventPagePaletteVariables(palette) as CSSProperties;
  const focalPosition = `${event.content.cover.focalX}% ${event.content.cover.focalY}%`;

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({
          text: event.title,
          title: event.title,
          url: location.href,
        });
      } else {
        await navigator.clipboard.writeText(location.href);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2_000);
      }
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") setCopied(false);
    }
  }

  return (
    <main
      className={styles.page}
      data-font={event.theme.font}
      data-layout={event.theme.layout}
      id="main-content"
      style={pageStyle}
      tabIndex={-1}
    >
      {event.indexable ? <meta content="index, follow" name="robots" /> : null}

      <div className={styles.shell}>
        <header
          className={styles.hero}
          data-cover={event.theme.cover}
          data-upload={event.coverUrl ? "" : undefined}
          style={
            event.coverUrl
              ? {
                  backgroundImage: `url(${event.coverUrl})`,
                  backgroundPosition: focalPosition,
                }
              : undefined
          }
        >
          <span aria-hidden="true" className={styles.heroBrand}>
            <BrandMark focusable="false" />
          </span>
          <div className={styles.heroCopy}>
            {event.isCanceled ? (
              <p className={styles.cancelled}>Cancelled</p>
            ) : null}
            <div className={styles.heroTitleRow}>
              <DateBadge date={occurrence.start} />
              <div>
                <h1>{event.title}</h1>
                <div className={styles.heroFacts}>
                  <span>
                    <Clock3 aria-hidden="true" size={16} />
                    {formatWhen(
                      occurrence.start,
                      occurrence.end,
                      event.isAllDay,
                    )}
                  </span>
                  {event.location ? (
                    <span>
                      <MapPin aria-hidden="true" size={16} />
                      {event.location}
                    </span>
                  ) : null}
                  {event.recurrence ? (
                    <span>
                      <Repeat2 aria-hidden="true" size={15} /> Repeats
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className={styles.layout}>
          <aside className={styles.sidebar}>
            {event.isCanceled ? null : <RsvpBlock token={token} />}

            <section className={styles.sideCard}>
              <h2>Organized by</h2>
              <div className={styles.organizer}>
                <Avatar
                  image={event.organizer.avatarUrl}
                  name={event.organizer.name}
                  size={42}
                />
                <strong>{event.organizer.name}</strong>
              </div>
            </section>

            {event.location ? (
              <section className={styles.sideCard}>
                <h2>Location</h2>
                {event.mapImageUrl ? (
                  <img
                    alt=""
                    className={styles.mapPreview}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    src={event.mapImageUrl}
                  />
                ) : null}
                <p>{event.location}</p>
                <a
                  href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(event.location)}`}
                  rel="noopener noreferrer nofollow"
                  target="_blank"
                >
                  Open in map <ExternalLink aria-hidden="true" size={13} />
                </a>
              </section>
            ) : null}

            <section className={styles.sideCard}>
              <h2>Share this event</h2>
              <Button
                icon={<Share2 size={15} />}
                variant="secondary"
                onClick={() => void share()}
              >
                {copied ? "Link copied" : "Share"}
              </Button>
            </section>
          </aside>

          <div className={styles.content}>
            {event.description || event.content.tags.length > 0 ? (
              <section className={styles.contentCard}>
                <h2>About this event</h2>
                {event.description ? (
                  <p className={styles.description}>{event.description}</p>
                ) : null}
                {event.content.tags.length > 0 ? (
                  <ul className={styles.tags} aria-label="Event tags">
                    {event.content.tags.map((tag) => (
                      <li key={tag}>{tag}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {event.content.agenda.length > 0 ? (
              <section className={styles.contentCard}>
                <h2>Program</h2>
                <ol className={styles.agenda}>
                  {event.content.agenda.map((item) => (
                    <li key={item.id}>
                      <time>{item.time}</time>
                      <span aria-hidden="true" />
                      <div>
                        <strong>{item.title}</strong>
                        {item.description ? <p>{item.description}</p> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            <section className={styles.contentCard}>
              <h2>Keep the date</h2>
              <p className={styles.timezone}>
                Times shown in {localTimezoneLabel()}.
              </p>
              <div className={styles.actions}>
                <Button
                  icon={<CalendarPlus size={16} strokeWidth={1.6} />}
                  onClick={() => downloadIcs(event, occurrence)}
                >
                  Add to calendar
                </Button>
                <a
                  className={styles.secondaryAction}
                  href={googleCalendarUrl(event, occurrence)}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Google Calendar
                </a>
              </div>
              {event.url ? (
                <a
                  className={styles.eventLink}
                  href={event.url}
                  rel="noopener noreferrer nofollow"
                  target="_blank"
                >
                  <LinkIcon aria-hidden="true" size={14} /> Event link
                </a>
              ) : null}
            </section>
          </div>
        </div>

        <p className={styles.footer}>
          Published with <a href="https://musubi.pro">Musubi</a>
        </p>
      </div>
    </main>
  );
}

function DateBadge({ date }: { date: Date }) {
  return (
    <time className={styles.dateBadge} dateTime={date.toISOString()}>
      <span>
        {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)}
      </span>
      <strong>
        {new Intl.DateTimeFormat(undefined, { day: "2-digit" }).format(date)}
      </strong>
      <span>
        {new Intl.DateTimeFormat(undefined, { month: "short" }).format(date)}
      </span>
    </time>
  );
}

type Occurrence = { end: Date; start: Date };

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

  return next
    ? { end: next.end, start: next.start }
    : { end: event.end, start: event.start };
}

function localTimezoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "your local timezone";
  }
}

function formatWhen(start: Date, end: Date, allDay: boolean): string {
  const date = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    weekday: "short",
  }).format(start);
  if (allDay) return date;

  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time.format(start)}–${time.format(end)}`;
}

function icsStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

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
    ...(event.description
      ? [`DESCRIPTION:${icsEscape(event.description)}`]
      : []),
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
