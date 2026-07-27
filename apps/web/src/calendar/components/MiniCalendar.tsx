import type { Settings } from "@musubi/types";
import { getMonthGrid } from "@musubi/calendar/layout";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";
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
  onDateChange,
  weekStartsOn,
}: {
  anchor: Date;
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
  const [focused, setFocused] = useState<number>();

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
  const anchorIndex = days.findIndex((day) => toDateKey(day) === anchorKey);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabbable = focused ?? Math.max(0, anchorIndex);

  function moveFocus(index: number) {
    const day = days[index];
    if (!day) {
      // Off the edge of the grid: page the month rather than trapping focus.
      showMonth(
        new Date(month.getFullYear(), month.getMonth() + (index < 0 ? -1 : 1), 1),
      );
      return;
    }
    setFocused(index);
    requestAnimationFrame(() => cellRefs.current[index]?.focus());
  }

  return (
    <section className={styles.miniCalendar} aria-label="Jump to date">
      <header className={styles.miniHeader}>
        <button
          aria-label="Previous month in date picker"
          className={styles.iconButton}
          type="button"
          onClick={() =>
            showMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
        >
          <ChevronLeft aria-hidden="true" size={15} strokeWidth={1.7} />
        </button>
        <h2 className={styles.sectionLabel}>
          {/* Short month: the toolbar already spells the period out in full,
              and this one has seven columns to fit. */}
          {month.toLocaleDateString("en", { month: "short", year: "numeric" })}
        </h2>
        <button
          aria-label="Next month in date picker"
          className={styles.iconButton}
          type="button"
          onClick={() =>
            showMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
        >
          <ChevronRight aria-hidden="true" size={15} strokeWidth={1.7} />
        </button>
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

              return (
                <button
                  aria-current={dateKey === anchorKey ? "date" : undefined}
                  aria-label={getLongDateLabel(day)}
                  className={styles.miniDay}
                  data-outside={
                    day.getMonth() === month.getMonth() ? undefined : ""
                  }
                  data-selected={dateKey === anchorKey ? "" : undefined}
                  data-today={dateKey === todayKey ? "" : undefined}
                  key={dateKey}
                  ref={(node) => {
                    cellRefs.current[index] = node;
                  }}
                  role="gridcell"
                  tabIndex={index === tabbable ? 0 : -1}
                  type="button"
                  onClick={() => onDateChange(dateKey)}
                  onFocus={() => setFocused(index)}
                  onKeyDown={(event) => {
                    const moves: Partial<Record<string, number>> = {
                      ArrowDown: 7,
                      ArrowLeft: -1,
                      ArrowRight: 1,
                      ArrowUp: -7,
                    };
                    const move = moves[event.key];
                    if (move === undefined) return;
                    event.preventDefault();
                    moveFocus(index + move);
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
