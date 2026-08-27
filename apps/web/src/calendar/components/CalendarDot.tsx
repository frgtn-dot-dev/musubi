import styles from "./styles/calendar-dot.module.css";

/**
 * The colour that ties a calendar to its events.
 *
 * Decorative on purpose: every place it appears already names the calendar in
 * text beside it, so announcing the colour would only repeat that.
 */
export function CalendarDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className={styles.calendarDot}
      style={{ backgroundColor: color }}
    />
  );
}
