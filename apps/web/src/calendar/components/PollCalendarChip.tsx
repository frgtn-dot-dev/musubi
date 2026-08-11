import type { CSSProperties } from "react";
import { CalendarClock } from "lucide-react";
import type { PollCalendar, PollCalendarDay } from "~/api/contracts";
import { getLongDateLabel, parseDateKey } from "../calendar-math";
import { shiftDayKey } from "../date-key";
import { getReadableEventTextColor } from "../event-color";
import styles from "./styles/poll-calendar.module.css";

export type PollCalendarItem = {
  date: string;
  day: PollCalendarDay;
  poll: PollCalendar;
};

export function pollCalendarItems(polls: PollCalendar[]): PollCalendarItem[] {
  return polls.flatMap((poll) =>
    poll.days.map((day) => ({ date: day.date, day, poll })),
  );
}

export function pollDayContinues(
  item: PollCalendarItem,
  offset: -1 | 1,
) {
  const adjacentDate = shiftDayKey(item.date, offset);
  return item.poll.days.some((day) => day.date === adjacentDate);
}

export function pollAvailability(item: PollCalendarItem) {
  const { day, poll } = item;
  if (poll.chosenSlotID) {
    return { color: "#c8553d", label: "Time picked" };
  }
  if (day.no > 0) {
    return { color: "#a95045", label: `${day.no} unavailable` };
  }
  if (poll.respondents > 0 && day.yes === poll.respondents) {
    return { color: "#4f8067", label: "Everyone is available" };
  }
  if (day.yes > 0 || day.ifNeeded > 0) {
    return { color: "#a97d32", label: "Availability is mixed" };
  }
  return { color: "#696761", label: "No answers yet" };
}

export function PollCalendarChip({
  className,
  continuesAfter = false,
  continuesBefore = false,
  item,
  onOpen,
  style,
}: {
  className?: string;
  continuesAfter?: boolean;
  continuesBefore?: boolean;
  item: PollCalendarItem;
  onOpen: (item: PollCalendarItem, trigger: HTMLButtonElement) => void;
  style?: CSSProperties;
}) {
  const availability = pollAvailability(item);
  return (
    <button
      aria-label={`${item.poll.title}, scheduling poll, ${getLongDateLabel(
        parseDateKey(item.date),
      )}, ${availability.label}`}
      className={`${styles.chip} ${className ?? ""}`}
      data-continues-after={continuesAfter ? "" : undefined}
      data-continues-before={continuesBefore ? "" : undefined}
      data-decided={item.poll.chosenSlotID ? "" : undefined}
      data-poll-calendar={item.poll.id}
      style={
        {
          ...style,
          "--poll-color": availability.color,
          "--poll-foreground": getReadableEventTextColor(availability.color),
        } as CSSProperties
      }
      title={availability.label}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item, event.currentTarget);
      }}
    >
      <CalendarClock aria-hidden="true" size={11} strokeWidth={1.8} />
      <span>{item.poll.title}</span>
    </button>
  );
}
