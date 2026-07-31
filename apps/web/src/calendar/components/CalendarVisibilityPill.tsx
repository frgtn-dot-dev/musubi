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
 * Used both for the temporary filter shelf and for a Page's saved visibility: it
 * is the same question in both places, and one control means the two cannot drift
 * apart. A pill answers "is this on" by how it looks rather than by a switch
 * beside a label, which is what the native client's filter bar does — and a strip
 * of them reads as a set of choices rather than a settings list.
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
