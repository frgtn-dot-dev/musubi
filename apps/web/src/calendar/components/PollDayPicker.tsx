import { addDays, getMonthGridWeeks } from "@musubi/calendar/layout";
import type { Settings } from "@musubi/types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { getWeekdayLabels } from "../calendar-math";
import { toDateKey } from "../date-key";
import { IconButton } from "~/ui/Button";
import styles from "./styles/scheduling.module.css";

/**
 * Which days a poll asks about.
 *
 * A month grid you drag across, not a list of rows. Asking about three weeks of
 * evenings meant adding twenty-one rows by hand before this — the reference
 * (srazovnik.cz) is day-first for exactly that reason, and a calendar is the one
 * control where "these three weeks, minus the weekend" is a single gesture.
 *
 * Three ways to say the same thing, because different questions have different
 * shapes: tap a day, drag a run of days, or tap a weekday letter to take every
 * Tuesday in view.
 */
export function PollDayPicker({
  onChange,
  selected,
  weekStartsOn,
}: {
  onChange: (days: string[]) => void;
  /** Day keys, sorted. The parent owns them so the times can multiply them. */
  selected: string[];
  weekStartsOn: Settings["weekStartsOn"];
}) {
  const [month, setMonth] = useState(() => new Date());
  // Which way a drag is going, decided by the day it started on: dragging from a
  // chosen day clears, from an empty one selects. Same rule as a spreadsheet.
  const drag = useRef<{ adding: boolean; from: string } | null>(null);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const todayKey = toDateKey(new Date());

  const weeks = useMemo(
    () => getMonthGridWeeks(month, weekStartsOn),
    [month, weekStartsOn],
  );
  const weekdayLabels = getWeekdayLabels(weekStartsOn);

  function apply(keys: string[], adding: boolean) {
    const next = new Set(chosen);
    for (const key of keys) {
      if (adding) next.add(key);
      else next.delete(key);
    }
    onChange([...next].sort());
  }

  function runBetween(from: string, to: string) {
    const [start, end] = from <= to ? [from, to] : [to, from];
    const days: string[] = [];
    for (
      let day = new Date(`${start}T00:00:00`);
      toDateKey(day) <= end;
      day = addDays(day, 1)
    ) {
      days.push(toDateKey(day));
    }
    return days;
  }

  return (
    <div className={styles.picker}>
      <div className={styles.pickerHeader}>
        <IconButton
          label="Previous month"
          size="compact"
          onClick={() => setMonth(addDays(startOfMonth(month), -1))}
        >
          <ChevronLeft size={16} strokeWidth={1.7} />
        </IconButton>
        <span className={styles.pickerMonth}>
          {new Intl.DateTimeFormat(undefined, {
            month: "long",
            year: "numeric",
          }).format(month)}
        </span>
        <IconButton
          label="Next month"
          size="compact"
          onClick={() => setMonth(addDays(endOfMonth(month), 1))}
        >
          <ChevronRight size={16} strokeWidth={1.7} />
        </IconButton>
      </div>

      <div className={styles.pickerWeekdays}>
        {weekdayLabels.map((label, index) => {
          // Every Tuesday in view, in one press — the shape most recurring
          // questions have ("which Thursday suits everyone this month?").
          const column = weeks
            .map((week) => week[index])
            .filter((day): day is Date => Boolean(day))
            .map(toDateKey);
          const allChosen = column.every((key) => chosen.has(key));

          return (
            <button
              className={styles.pickerWeekday}
              key={label}
              title={`${allChosen ? "Clear" : "Select"} every ${label} in view`}
              type="button"
              onClick={() => apply(column, !allChosen)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        className={styles.pickerGrid}
        onPointerLeave={() => {
          drag.current = null;
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        {weeks.flat().map((day) => {
          const key = toDateKey(day);
          const outside = day.getMonth() !== month.getMonth();
          const isChosen = chosen.has(key);

          return (
            <button
              aria-pressed={isChosen}
              className={styles.pickerDay}
              data-outside={outside ? "" : undefined}
              data-today={key === todayKey ? "" : undefined}
              key={key}
              type="button"
              onPointerDown={(event) => {
                // Pointer capture would keep every move event on the first
                // button, which is the opposite of what a drag across days needs.
                event.currentTarget.releasePointerCapture?.(event.pointerId);
                drag.current = { adding: !isChosen, from: key };
                apply([key], !isChosen);
              }}
              onPointerEnter={() => {
                if (!drag.current) return;
                apply(runBetween(drag.current.from, key), drag.current.adding);
              }}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}
