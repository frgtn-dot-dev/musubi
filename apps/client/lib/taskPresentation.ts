import { formatDateMedium, formatTime, type DateFormat, type TimeFormat } from "./datetimeFormat";

export const taskPriorityLabel = (priority: number) => priority === 0
  ? "No priority"
  : `${priority <= 4 ? "High" : priority === 5 ? "Medium" : "Low"} (${priority})`;


// All-day task fields are UTC civil dates; completedAt remains an instant.
export function formatTaskDate(value: Date, allDay: boolean, dateFormat: DateFormat, timeFormat: TimeFormat) {
  const civil = allDay ? new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12) : value;
  return formatDateMedium(civil, dateFormat) + (allDay ? "" : `, ${formatTime(value, timeFormat)}`);
}
