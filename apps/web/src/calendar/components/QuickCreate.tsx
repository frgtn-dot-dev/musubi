import * as Popover from "@radix-ui/react-popover";
import type { Calendar, Event } from "@musubi/types";
import { CalendarDays, ChevronDown, Clock3, Plus, X } from "lucide-react";
import { useState } from "react";
import styles from "./workspace.module.css";

type QuickCreateProps = {
  calendars: Calendar[];
  date: string;
  onCreate: (event: Event) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function QuickCreate({
  calendars,
  date,
  onCreate,
  onOpenChange,
  open,
}: QuickCreateProps) {
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState(date);
  const [time, setTime] = useState("12:00");
  const [calendarId, setCalendarId] = useState(
    calendars[0]?.id ?? "personal",
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const start = new Date(`${eventDate}T${time}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1_000);
    const calendar = calendars.find((item) => item.id === calendarId);

    onCreate({
      id: crypto.randomUUID(),
      calendars: [calendarId],
      color: calendar?.color ?? "#7a8ba3",
      creatorID: "prototype-user",
      end,
      hasAttendees: false,
      isAllDay: false,
      isCanceled: false,
      organizer: "prototype@musubi.local",
      originCalendarID: calendarId,
      start,
      title: title.trim(),
    });

    setTitle("");
    onOpenChange(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          className={styles.eventButton}
          type="button"
          aria-label="Create event"
        >
          <Plus aria-hidden="true" size={18} strokeWidth={1.7} />
          <span>Event</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={`${styles.popover} ${styles.createPopover}`}
          align="end"
          sideOffset={10}
          collisionPadding={14}
          aria-label="Create event"
        >
          <form onSubmit={handleSubmit}>
            <div className={styles.popoverHeader}>
              <h2>New event</h2>
              <Popover.Close asChild>
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label="Close new event"
                >
                  <X aria-hidden="true" size={17} strokeWidth={1.6} />
                </button>
              </Popover.Close>
            </div>

            <label className={styles.srOnly} htmlFor="quick-title">
              Event title
            </label>
            <input
              autoFocus
              className={styles.titleInput}
              id="quick-title"
              placeholder="Event title"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />

            <label className={styles.formRow}>
              <CalendarDays aria-hidden="true" size={17} strokeWidth={1.5} />
              <span className={styles.srOnly}>Date</span>
              <input
                required
                type="date"
                value={eventDate}
                onChange={(event) => setEventDate(event.target.value)}
              />
            </label>

            <label className={styles.formRow}>
              <Clock3 aria-hidden="true" size={17} strokeWidth={1.5} />
              <span className={styles.srOnly}>Start time</span>
              <input
                required
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
              <span className={styles.duration}>1 hour</span>
            </label>

            <label className={styles.formRow}>
              <span
                className={styles.calendarDot}
                style={{
                  backgroundColor:
                    calendars.find((item) => item.id === calendarId)?.color ??
                    "#7a8ba3",
                }}
              />
              <span className={styles.srOnly}>Calendar</span>
              <select
                value={calendarId}
                onChange={(event) => setCalendarId(event.target.value)}
              >
                {calendars.map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className={styles.selectChevron}
                aria-hidden="true"
                size={16}
                strokeWidth={1.5}
              />
            </label>

            <div className={styles.createActions}>
              <button
                className={styles.textButton}
                type="button"
                onClick={() => onOpenChange(false)}
              >
                More options
              </button>
              <button className={styles.primaryButton} type="submit">
                Save
              </button>
            </div>
          </form>
          <Popover.Arrow className={styles.popoverArrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
