import type { Calendar, Event, Task } from "@musubi/types";

/** Render-only calendar item. Never send this projection to an event endpoint. */
export type CalendarTask = Event & { calendarTask: Task };
export function isCalendarTask(event: Event): event is CalendarTask {
  return "calendarTask" in event;
}

/**
 * Scheduled starts live in the time grid; deadlines in the all-day rail.
 * Render-only 30-minute footprints never become a stored task duration.
 * Musubi all-day ends are inclusive. Both markers open the same task.
 */
export function calendarTasks(tasks: readonly Task[], calendars: readonly Calendar[]): CalendarTask[] {
  const byId = new Map(calendars.map(calendar => [calendar.id, calendar]));
  return tasks.flatMap(task => {
    const calendar = byId.get(task.calendarID);
    if (!calendar || task.status === "cancelled") return [];
    const result: CalendarTask[] = [];
    for (const kind of ["start", "due"] as const) {
      const value = task[kind];
      if (!value || !Number.isFinite(value.getTime())) continue;
      const allDay = task.isAllDay || kind === "due";
      const start = allDay
        ? task.isAllDay
          ? new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
          : new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()))
        : new Date(value);
      if (allDay && result.some(item => item.isAllDay && item.start.getTime() === start.getTime())) continue;
      const nextDay = new Date(start);
      nextDay.setHours(24, 0, 0, 0);
      result.push({
        id: `calendar-task:${task.id}:${kind}`, calendarTask: task,
        creatorID: task.creatorID, organizer: task.creatorID,
        title: task.title, color: calendar.color, start,
        end: new Date(allDay ? start.getTime() : Math.min(start.getTime() + 30 * 60000, nextDay.getTime())),
        calendars: [task.calendarID], originCalendarID: task.calendarID,
        isCanceled: false, isAllDay: allDay, hasAttendees: false,
        timeModel: allDay ? { kind: "all-day" } : undefined,
      });
    }
    return result;
  });
}
