import type { Calendar } from "@musubi/types";
import type { CSSProperties } from "react";
import styles from "./workspace.module.css";

type CalendarFilterPillProps = {
  calendar: Calendar;
  onVisibleChange: (visible: boolean) => void;
  visible: boolean;
};

/**
 * One calendar, on or off, as a pill you tap.
 *
 * The filter shelf is a strip of choices you flick through, not a settings list:
 * a pill answers "is this on" by how it looks rather than by a control beside a
 * label, which is what the native client's filter bar does. The sidebar keeps its
 * switch rows — there it doubles as the legend, and a vertical list of pills
 * would read as navigation.
 */
export function CalendarFilterPill({
  calendar,
  onVisibleChange,
  visible,
}: CalendarFilterPillProps) {
  return (
    <button
      aria-pressed={visible}
      className={styles.filterPill}
      style={{ "--pill-color": calendar.color } as CSSProperties}
      type="button"
      onClick={() => onVisibleChange(!visible)}
    >
      <span aria-hidden="true" className={styles.filterPillDot} />
      {calendar.name}
    </button>
  );
}
