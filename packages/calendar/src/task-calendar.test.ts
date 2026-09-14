import assert from "node:assert/strict";
import { CalendarSchema, TaskSchema } from "@musubi/types";
import { calendarTasks, isCalendarTask } from "./task-calendar";
const calendar = CalendarSchema.parse({ id: "cal", creatorID: "owner", name: "Tasks", color: "#123456", role: "owner", members: [], isDefault: false });
const task = TaskSchema.parse({ id: "one", creatorID: "owner", calendarID: "cal", title: "Deadline", start: "2026-09-10T09:00:00Z", due: "2026-09-15T14:00:00Z" });
const projected = calendarTasks([task], [calendar])[0];
assert.ok(isCalendarTask(projected));
assert.equal(projected.start.toISOString(), "2026-09-10T09:00:00.000Z");
assert.equal(projected.end.getTime() - projected.start.getTime(), 1800000);
assert.equal(projected.calendarTask, task);
assert.equal(calendarTasks([{ ...task, due: null }], [calendar])[0].start.getTime(), task.start!.getTime());
assert.equal(calendarTasks([{ ...task, due: null, start: null }], [calendar]).length, 0);
assert.equal(calendarTasks([task], []).length, 0);
assert.equal(calendarTasks([{ ...task, status: "cancelled" }], [calendar]).length, 0);
assert.equal(calendarTasks([{ ...task, status: "completed" }], [calendar]).length, 2);
const allDay = calendarTasks([{ ...task, start: null, isAllDay: true }], [calendar])[0];
assert.equal(allDay.start.toISOString(), "2026-09-15T00:00:00.000Z");
assert.equal(allDay.end.toISOString(), "2026-09-15T00:00:00.000Z");
assert.equal(task.due!.toISOString(), "2026-09-15T14:00:00.000Z");


assert.equal(calendarTasks([{ ...task, isAllDay: true, start: task.due }], [calendar]).length, 1);

const previousZone = process.env.TZ;
for (const zone of ["Europe/Prague", "America/Los_Angeles", "Pacific/Auckland"]) {
  process.env.TZ = zone;
  const date = new Date("2026-09-15T00:30:00Z");
  const deadline = calendarTasks([{ ...task, start: null, due: date }], [calendar])[0];
  assert.equal(deadline.start.getUTCDate(), date.getDate());
  const lateStart = new Date(2026, 8, 15, 23, 50);
  const late = calendarTasks([{ ...task, start: lateStart, due: null }], [calendar])[0];
  assert.equal(late.end.getTime() - late.start.getTime(), 10 * 60000);
}
if (previousZone === undefined) delete process.env.TZ;
else process.env.TZ = previousZone;
console.log("Task calendar projection passed");
