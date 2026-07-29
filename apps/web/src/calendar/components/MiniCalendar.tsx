import type { Settings } from "@musubi/types";
import { getMonthGrid } from "@musubi/calendar/layout";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { IconButton } from "~/ui/Button";
import { SectionLabel } from "~/ui/SectionLabel";
import { getLongDateLabel, getWeekdayLabels } from "../calendar-math";
import { toDateKey } from "../date-key";
import styles from "./workspace.module.css";

const monthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;

const startOfMonth = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), 1);

/**
 * Orientation, not a second calendar: it shows where the current date sits in
 * the month and jumps the main view without changing the view, filters or the
 * scroll position.
 *
 * One tab stop, arrows move the focused day — 42 tab stops in the sidebar would
 * bury everything below it.
 */
export function MiniCalendar({
  anchor,
  label = "Jump to date",
  max,
  min,
  onDateChange,
  weekStartsOn,
}: {
  anchor: Date;
  label?: string;
  max?: string;
  min?: string;
  onDateChange: (date: string) => void;
  weekStartsOn: Settings["weekStartsOn"];
}) {
  // The month on show follows the main view, but can also be paged on its own —
  // so it is state seeded from the anchor and re-seeded when the anchor's month
  // changes under it.
  const [month, setMonth] = useState(() => startOfMonth(anchor));
  const [seededFrom, setSeededFrom] = useState(() => monthKey(anchor));
  // Undefined focus means "follow the anchor" — the common case, and what a
  // paged month falls back to.
  const [focused, setFocused] = useState<string>();

  function showMonth(next: Date) {
    setMonth(next);
    setFocused(undefined);
  }

  if (seededFrom !== monthKey(anchor)) {
    setSeededFrom(monthKey(anchor));
    showMonth(startOfMonth(anchor));
  }

  const days = useMemo(
    () => getMonthGrid(month, weekStartsOn),
    [month, weekStartsOn],
  );
  const weekdayLabels = getWeekdayLabels(weekStartsOn);
  const anchorKey = toDateKey(anchor);
  const todayKey = toDateKey(new Date());
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const unavailable = (dateKey: string) =>
    Boolean((min && dateKey < min) || (max && dateKey > max));
  const focusedIsVisible =
    focused !== undefined &&
    days.some(
      (day) =>
        toDateKey(day) === focused && !unavailable(toDateKey(day)),
    );
  const anchorIsVisible = days.some(
    (day) =>
      toDateKey(day) === anchorKey && !unavailable(toDateKey(day)),
  );
  const tabbableKey = focusedIsVisible
    ? focused
    : anchorIsVisible
      ? anchorKey
      : days.map(toDateKey).find((dateKey) => !unavailable(dateKey));

  function focusDate(day: Date) {
    const dateKey = toDateKey(day);
    if (unavailable(dateKey)) return;
    setMonth(startOfMonth(day));
    setFocused(dateKey);
    requestAnimationFrame(() => cellRefs.current.get(dateKey)?.focus());
  }

  return (
    <section className={styles.miniCalendar} aria-label={label}>
      <header className={styles.miniHeader}>
        <IconButton
          disabled={
            min
              ? toDateKey(
                  new Date(month.getFullYear(), month.getMonth(), 0),
                ) < min
              : false
          }
          label="Previous month in date picker"
          size="compact"
          onClick={() =>
            showMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
        >
          <ChevronLeft aria-hidden="true" size={15} strokeWidth={1.7} />
        </IconButton>
        <SectionLabel className={styles.miniTitle}>
          {/* Short month: the toolbar already spells the period out in full,
              and this one has seven columns to fit. */}
          {month.toLocaleDateString("en", { month: "short", year: "numeric" })}
        </SectionLabel>
        <IconButton
          disabled={
            max
              ? toDateKey(
                  new Date(month.getFullYear(), month.getMonth() + 1, 1),
                ) > max
              : false
          }
          label="Next month in date picker"
          size="compact"
          onClick={() =>
            showMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
        >
          <ChevronRight aria-hidden="true" size={15} strokeWidth={1.7} />
        </IconButton>
      </header>

      <div className={styles.miniGrid} role="grid">
        <div className={styles.miniWeekdays} role="row">
          {weekdayLabels.map((weekday) => (
            <abbr key={weekday} role="columnheader" title={weekday}>
              {weekday.slice(0, 1)}
            </abbr>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, week) => (
          <div
            className={styles.miniWeek}
            key={toDateKey(days[week * 7]!)}
            role="row"
          >
            {days.slice(week * 7, week * 7 + 7).map((day, offset) => {
              const index = week * 7 + offset;
              const dateKey = toDateKey(day);
              const disabled = unavailable(dateKey);

              return (
                <button
                  aria-current={dateKey === todayKey ? "date" : undefined}
                  aria-label={getLongDateLabel(day)}
                  aria-selected={dateKey === anchorKey}
                  className={styles.miniDay}
                  data-outside={
                    day.getMonth() === month.getMonth() ? undefined : ""
                  }
                  data-selected={dateKey === anchorKey ? "" : undefined}
                  data-today={dateKey === todayKey ? "" : undefined}
                  disabled={disabled}
                  key={dateKey}
                  ref={(node) => {
                    if (node) {
                      cellRefs.current.set(dateKey, node);
                    } else {
                      cellRefs.current.delete(dateKey);
                    }
                  }}
                  role="gridcell"
                  tabIndex={dateKey === tabbableKey ? 0 : -1}
                  type="button"
                  onClick={() => onDateChange(dateKey)}
                  onFocus={() => setFocused(dateKey)}
                  onKeyDown={(event) => {
                    const target = new Date(day);
                    if (event.key === "ArrowDown") {
                      target.setDate(target.getDate() + 7);
                    } else if (event.key === "ArrowLeft") {
                      target.setDate(target.getDate() - 1);
                    } else if (event.key === "ArrowRight") {
                      target.setDate(target.getDate() + 1);
                    } else if (event.key === "ArrowUp") {
                      target.setDate(target.getDate() - 7);
                    } else if (event.key === "Home") {
                      target.setDate(target.getDate() - (index % 7));
                    } else if (event.key === "End") {
                      target.setDate(target.getDate() + (6 - (index % 7)));
                    } else if (
                      event.key === "PageUp" ||
                      event.key === "PageDown"
                    ) {
                      const direction = event.key === "PageUp" ? -1 : 1;
                      const targetMonth = day.getMonth() + direction;
                      const lastDay = new Date(
                        day.getFullYear(),
                        targetMonth + 1,
                        0,
                      ).getDate();
                      target.setFullYear(
                        day.getFullYear(),
                        targetMonth,
                        Math.min(day.getDate(), lastDay),
                      );
                    } else {
                      return;
                    }
                    event.preventDefault();
                    focusDate(target);
                  }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
