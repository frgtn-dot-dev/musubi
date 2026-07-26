export const calendarViews = [
  { id: "day", label: "Day", enabled: true },
  { id: "week", label: "Week", enabled: true },
  { id: "month", label: "Month", enabled: true },
  { id: "agenda", label: "Agenda", enabled: true },
] as const;

export type CalendarViewId = (typeof calendarViews)[number]["id"];

export function isCalendarView(value: string): value is CalendarViewId {
  return calendarViews.some((view) => view.id === value);
}
