import { and, eq, isNull, sql } from "drizzle-orm";
import { calendarMembers, db, tasks, type NewTask } from "..";

export type TaskMutation = Pick<
  NewTask,
  | "calendarID"
  | "title"
  | "description"
  | "status"
  | "start"
  | "due"
  | "isAllDay"
  | "completedAt"
  | "percentComplete"
  | "priority"
  | "recurrence"
  | "relatedTo"
  | "url"
>;

export async function createTask(
  values: TaskMutation & Pick<NewTask, "id" | "creatorID">,
) {
  const [task] = await db.insert(tasks).values({ ...values, providerReadRetiredGeneration: null }).returning();
  return task;
}

export async function getTask(id: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)));
  return task ?? null;
}

export async function getUserTask(userID: string, id: string) {
  const [row] = await db
    .select({ task: tasks })
    .from(tasks)
    .innerJoin(
      calendarMembers,
      eq(tasks.calendarID, calendarMembers.calendarID),
    )
    .where(
      and(
        eq(tasks.id, id),
        eq(calendarMembers.userID, userID),
        isNull(tasks.deletedAt),
      ),
    );
  return row?.task ?? null;
}

export async function getUserTasks(userID: string) {
  const rows = await db
    .select({ task: tasks })
    .from(tasks)
    .innerJoin(
      calendarMembers,
      eq(tasks.calendarID, calendarMembers.calendarID),
    )
    .where(and(eq(calendarMembers.userID, userID), isNull(tasks.deletedAt)));
  return rows.map(({ task }) => task);
}

export async function updateTask(id: string, values: TaskMutation, expectedProviderReadRetiredGeneration = 0) {
  const [task] = await db
    .update(tasks)
    .set({ ...values, providerReadRetiredGeneration: sql`${tasks.providerReadRetiredGeneration}`, sequence: sql`${tasks.sequence} + 1` })
    .where(and(eq(tasks.id, id), isNull(tasks.deletedAt), sql`coalesce(${tasks.providerReadRetiredGeneration}, 0) = ${expectedProviderReadRetiredGeneration}`, sql`not exists (select 1 from external_calendars source where source.calendar_id = ${tasks.calendarID} and source.provider = 'caldav' and source.provider_access_role like 'caldav:read=no;%')`))
    .returning();
  return task ?? null;
}

export async function removeTask(id: string) {
  const [task] = await db
    .update(tasks)
    .set({ deletedAt: new Date() })
    .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
    .returning();
  return task ?? null;
}
