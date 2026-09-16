import type { Settings } from "@musubi/types";

export function formatTaskDate(date: Date, allDay: boolean, settings: Pick<Settings, "dateFormat" | "timeFormat">) {
  const day = String(allDay ? date.getUTCDate() : date.getDate()).padStart(2, "0");
  const month = String((allDay ? date.getUTCMonth() : date.getMonth()) + 1).padStart(2, "0");
  const year = allDay ? date.getUTCFullYear() : date.getFullYear();
  const label = settings.dateFormat === "ymd" ? `${year}-${month}-${day}` : settings.dateFormat === "mdy" ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
  return allDay ? label : `${label}, ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: settings.timeFormat === "12h" }).format(date)}`;
}
