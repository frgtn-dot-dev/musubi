import {
  addDays,
  startOfWeek,
  type WeekStartsOn,
} from "./ranges";

export type CalendarRange = {
  endExclusive: Date;
  start: Date;
};

// A stable six-week grid keeps Month geometry consistent while paging.
export function getMonthGrid(
  month: Date,
  weekStartsOn: WeekStartsOn,
): Date[] {
  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const firstVisibleDay = startOfWeek(firstOfMonth, weekStartsOn);

  return Array.from({ length: 42 }, (_, index) =>
    addDays(firstVisibleDay, index),
  );
}

export function getMonthGridWeeks(
  month: Date,
  weekStartsOn: WeekStartsOn,
): Date[][] {
  const days = getMonthGrid(month, weekStartsOn);

  return Array.from({ length: 6 }, (_, weekIndex) =>
    days.slice(weekIndex * 7, weekIndex * 7 + 7),
  );
}

export function getMonthGridRange(
  month: Date,
  weekStartsOn: WeekStartsOn,
  paddingDays = 0,
): CalendarRange {
  const days = getMonthGrid(month, weekStartsOn);

  return {
    endExclusive: addDays(days[days.length - 1]!, paddingDays + 1),
    start: addDays(days[0]!, -paddingDays),
  };
}
