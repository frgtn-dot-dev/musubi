import type { Calendar } from "@musubi/types";
import { RowToggle } from "~/ui/Row";
import styles from "./workspace.module.css";

type CalendarVisibilityRowProps = {
  calendar: Calendar;
  onVisibleChange: (visible: boolean) => void;
  visible: boolean;
};

/**
 * Calendar visibility is the same choice wherever it appears. Keeping one row
 * for the sidebar and filter shelf means its label, state and pointer target
 * cannot drift between the two entry points.
 */
export function CalendarVisibilityRow({
  calendar,
  onVisibleChange,
  visible,
}: CalendarVisibilityRowProps) {
  return (
    <RowToggle
      checked={visible}
      className={styles.calendarVisibilityRow}
      icon={
        <span
          className={styles.calendarDot}
          style={{ backgroundColor: calendar.color }}
        />
      }
      label={calendar.name}
      size="compact"
      onCheckedChange={onVisibleChange}
    />
  );
}
