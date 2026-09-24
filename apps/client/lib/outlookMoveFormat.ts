import type { DateFormat, TimeFormat } from "./datetimeFormat";

/** A series can be in a different zone from the phone. Never format its preview in device time. */
export function outlookMoveFormat(timeZone: string, dateFormat: DateFormat, timeFormat: TimeFormat) {
  const date = new Intl.DateTimeFormat("en", { timeZone, day: "numeric", month: "short", year: "numeric" });
  const clock = new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit", hourCycle: timeFormat === "12h" ? "h12" : "h23" });
  const formatDate = (stamp: string) => {
    const parts = date.formatToParts(new Date(stamp));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
    const d = part("day"), m = part("month"), y = part("year");
    return dateFormat === "ymd" ? `${y} ${m} ${d}` : dateFormat === "mdy" ? `${m} ${d}, ${y}` : `${d} ${m} ${y}`;
  };
  return {
    date: formatDate,
    range: (start: string, end: string) => `${clock.format(new Date(start))}–${formatDate(start) !== formatDate(end) ? `${formatDate(end)}, ` : ""}${clock.format(new Date(end))}`,
  };
}
