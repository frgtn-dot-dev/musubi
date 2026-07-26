export const calendarViews = [
  { id: "day", label: "Day", enabled: false },
  { id: "week", label: "Week", enabled: false },
  { id: "month", label: "Month", enabled: true },
  { id: "agenda", label: "Agenda", enabled: true },
] as const;

export type CalendarViewId = (typeof calendarViews)[number]["id"];

export function isCalendarView(value: string): value is CalendarViewId {
  return calendarViews.some((view) => view.id === value);
}
