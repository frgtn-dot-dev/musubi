import { describeAdvanced, isEditableRRule, parseAdvanced } from "@musubi/calendar/rrule-editor";
import type { Task } from "@musubi/types";
import { formatDateMedium, formatTime, type DateFormat, type TimeFormat } from "./datetimeFormat";

export const taskPriorityLabel = (priority: number) => priority === 0
  ? "No priority"
  : `${priority <= 4 ? "High" : priority === 5 ? "Medium" : "Low"} (${priority})`;


// All-day task fields are UTC civil dates; completedAt remains an instant.
export function formatTaskDate(value: Date, allDay: boolean, dateFormat: DateFormat, timeFormat: TimeFormat) {
  const civil = allDay ? new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12) : value;
  return formatDateMedium(civil, dateFormat) + (allDay ? "" : `, ${formatTime(value, timeFormat)}`);
}

export function taskRepeatLabel(task: Pick<Task, "recurrence" | "start" | "due" | "isAllDay">): string | null {
  if (!isEditableRRule(task.recurrence)) return null;
  const anchor = task.start ?? task.due;
  const config = parseAdvanced(task.recurrence, anchor ? (task.isAllDay ? anchor.getUTCDay() : anchor.getDay()) : 1);
  if (!anchor && !task.recurrence?.includes("BYDAY=")) config.days.clear();
  return describeAdvanced(config);
}
