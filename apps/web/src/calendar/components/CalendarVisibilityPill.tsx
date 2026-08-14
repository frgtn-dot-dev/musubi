import type { Calendar } from "@musubi/types";
import type { CSSProperties } from "react";
import styles from "./workspace.module.css";

type CalendarVisibilityPillProps = {
  calendar: Calendar;
  onVisibleChange: (visible: boolean) => void;
  visible: boolean;
};

/**
 * One calendar, shown or hidden, as a pill you tap.
 *
 * A Page's saved visibility control. A pill answers "is this on" by how it looks
 * rather than by placing a separate switch beside every calendar.
 */
export function CalendarVisibilityPill({
  calendar,
  onVisibleChange,
  visible,
}: CalendarVisibilityPillProps) {
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
