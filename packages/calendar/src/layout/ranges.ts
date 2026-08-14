import dayjs from "dayjs";

export type WeekStartsOn = 0 | 1 | "monday" | "sunday";

export function weekStartIndex(weekStartsOn: WeekStartsOn): 0 | 1 {
  return weekStartsOn === 0 || weekStartsOn === "sunday" ? 0 : 1;
}

export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function addDays(date: Date, amount: number): Date {
  return dayjs(date).add(amount, "day").toDate();
}

export function addMonths(date: Date, amount: number): Date {
  return dayjs(date).add(amount, "month").toDate();
}

export function addMonthPages(date: Date, amount: number): Date {
  return dayjs(date).startOf("month").add(amount, "month").toDate();
}

export function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function startOfWeek(
  date: Date,
  weekStartsOn: WeekStartsOn,
): Date {
  const day = startOfDay(date);
  const difference =
    (day.getDay() - weekStartIndex(weekStartsOn) + 7) % 7;

  return addDays(day, -difference);
}

export function dayKey(date: Date): string {
  return dayjs(date).format("YYYY-MM-DD");
}

// All-day boundaries represent timezone-independent calendar dates at UTC
// midnight. Timed boundaries remain in the viewer's local calendar frame.
export function eventDayKey(date: Date, isAllDay: boolean): string {
  return isAllDay ? date.toISOString().slice(0, 10) : dayKey(date);
}

export function eventDayDate(date: Date, isAllDay: boolean): Date {
  return isAllDay
    ? new Date(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
      )
    : date;
}
