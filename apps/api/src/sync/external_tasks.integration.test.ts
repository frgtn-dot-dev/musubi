import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  calendars,
  db,
  events,
  externalEvents,
  externalTasks,
  sweepExternalEvents,
  sweepExternalTasks,
  tasks,
  upsertExternalEvent,
  upsertExternalTask,
  user,
} from "@musubi/db";

const provider = "caldav";
const externalCalendarID = "https://dav.example/cal/";

async function main() {
  if (process.env.ENVIRONMENT !== "test") {
    throw new Error(
      "Refusing to run external task DB integration test unless ENVIRONMENT=test",
    );
  }

  const userID = `external-task-sync-${randomUUID()}`;
  const calendarID = randomUUID();
  await db.insert(user).values({
    id: userID,
    name: "External task sync test",
    email: `${userID}@example.test`,
  });
  await db.insert(calendars).values({
    id: calendarID,
    creatorID: userID,
    name: "CalDAV",
    color: "#7A8BA3",
  });

  try {
    await seedLiveObjects(userID, calendarID);
    await assertEtagNoOps(userID, calendarID);
    await assertMixedResetSweep(calendarID);
    await assertTombstoneRevival(userID, calendarID);
    console.log("external task DB integration self-check: OK");
  } finally {
    await db.delete(user).where(eq(user.id, userID));
  }
}

async function seedLiveObjects(userID: string, calendarID: string) {
  assert.equal(
    await upsertExternalEvent(
      provider,
      userID,
      calendarID,
      externalCalendarID,
      "event-kept",
      eventValues("Kept event"),
      '"event-v1"',
      "event-kept@example.test",
    ),
    true,
  );
  assert.equal(
    await upsertExternalEvent(
      provider,
      userID,
      calendarID,
      externalCalendarID,
      "event-gone",
      eventValues("Gone event"),
      '"event-gone-v1"',
      "event-gone@example.test",
    ),
    true,
  );
  assert.equal(
    await upsertExternalTask(
      provider,
      userID,
      calendarID,
      externalCalendarID,
      "task-kept",
      taskValues("Kept task"),
      '"task-v1"',
      "task-kept@example.test",
    ),
    true,
  );
  assert.equal(
    await upsertExternalTask(
      provider,
      userID,
      calendarID,
      externalCalendarID,
      "task-gone",
      taskValues("Gone task"),
      '"task-gone-v1"',
      "task-gone@example.test",
    ),
    true,
  );
}

async function assertEtagNoOps(userID: string, calendarID: string) {
  assert.equal(
    await upsertExternalEvent(
      provider,
      userID,
      calendarID,
      externalCalendarID,
      "event-kept",
      eventValues("Must not overwrite"),
      '"event-v1"',
      "different-uid@example.test",
    ),
    false,
  );
  assert.equal(
    await upsertExternalTask(
      provider,
      userID,
      calendarID,
      externalCalendarID,
      "task-kept",
      taskValues("Must not overwrite"),
      '"task-v1"',
      "different-task-uid@example.test",
    ),
    false,
  );

  const [event, task] = await Promise.all([
    db
      .select({ title: events.title })
      .from(events)
      .innerJoin(externalEvents, eq(externalEvents.eventID, events.id))
      .where(eq(externalEvents.externalEventID, "event-kept")),
    db
      .select({ title: tasks.title })
      .from(tasks)
      .innerJoin(externalTasks, eq(externalTasks.taskID, tasks.id))
      .where(eq(externalTasks.externalTaskID, "task-kept")),
  ]);
  assert.equal(event[0]?.title, "Kept event");
  assert.equal(task[0]?.title, "Kept task");
}

async function assertMixedResetSweep(calendarID: string) {
  assert.equal(
    await sweepExternalEvents(provider, calendarID, ["event-kept"]),
    1,
  );
  assert.equal(
    await sweepExternalTasks(provider, calendarID, ["task-kept"]),
    1,
  );

  const [eventRows, taskRows] = await Promise.all([
    db
      .select({
        externalID: externalEvents.externalEventID,
        deletedAt: events.deletedAt,
      })
      .from(events)
      .innerJoin(externalEvents, eq(externalEvents.eventID, events.id))
      .where(eq(externalEvents.calendarID, calendarID)),
    db
      .select({
        externalID: externalTasks.externalTaskID,
        deletedAt: tasks.deletedAt,
      })
      .from(tasks)
      .innerJoin(externalTasks, eq(externalTasks.taskID, tasks.id))
      .where(eq(externalTasks.calendarID, calendarID)),
  ]);
  assert.equal(
    eventRows.find((row) => row.externalID === "event-kept")?.deletedAt,
    null,
  );
  assert.ok(
    eventRows.find((row) => row.externalID === "event-gone")?.deletedAt,
  );
  assert.equal(
    taskRows.find((row) => row.externalID === "task-kept")?.deletedAt,
    null,
  );
  assert.ok(taskRows.find((row) => row.externalID === "task-gone")?.deletedAt);
}

async function assertTombstoneRevival(userID: string, calendarID: string) {
  assert.equal(
    await upsertExternalTask(
      provider,
      userID,
      calendarID,
      externalCalendarID,
      "task-gone",
      taskValues("Revived task"),
      '"task-gone-v2"',
      "task-gone@example.test",
    ),
    true,
  );
  const [revived] = await db
    .select({ deletedAt: tasks.deletedAt, title: tasks.title })
    .from(tasks)
    .innerJoin(externalTasks, eq(externalTasks.taskID, tasks.id))
    .where(
      and(
        eq(externalTasks.calendarID, calendarID),
        eq(externalTasks.externalTaskID, "task-gone"),
      ),
    );
  assert.equal(revived?.deletedAt, null);
  assert.equal(revived?.title, "Revived task");
}

function eventValues(title: string) {
  return {
    title,
    color: "#7A8BA3",
    start: new Date("2026-01-01T10:00:00Z"),
    end: new Date("2026-01-01T11:00:00Z"),
    isAllDay: false,
    description: null,
    location: null,
    organizer: "",
    recurrence: null,
    url: null,
  };
}

function taskValues(title: string) {
  return {
    title,
    description: null,
    status: "needs-action" as const,
    start: null,
    due: null,
    isAllDay: false,
    completedAt: null,
    percentComplete: 0,
    priority: 0,
    recurrence: null,
    relatedTo: null,
    sequence: 0,
    url: null,
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
