import { lockCalendarLifecycle, lockUserLifecycle } from "./calendar-lifecycle";
import { eq, inArray, or, sql } from "drizzle-orm";
import { db, user, userAvatars, calendars, events, calendarEvents } from "..";
import { config } from "@musubi/config";
import { ForbiddenError } from "@musubi/types";

/** Preserve account-delete FK retention/purge behavior, but version every
 * surviving event whose origin or calendar links the cascade changes. */
export async function deleteUserWithCalendarRevisions(userID: string) {
  return db.transaction(async (tx) => {
    await lockUserLifecycle(tx, [userID], "exclusive");
    const owned = await tx.select({ id: calendars.id }).from(calendars).where(eq(calendars.creatorID, userID));
    const ids = owned.map((calendar) => calendar.id);
    await lockCalendarLifecycle(tx, ids, "exclusive");
    const affected = await tx.select({ id: events.id, creatorID: events.creatorID }).from(events).where(or(
      eq(events.creatorID, userID),
      ...(ids.length ? [inArray(events.originCalendarID, ids),
        sql`${events.id} in (select ${calendarEvents.eventID} from ${calendarEvents} where ${inArray(calendarEvents.calendarID, ids)})`] : []),
    )).orderBy(events.id).for("update");
    const surviving = affected.filter((event) => event.creatorID !== userID).map((event) => event.id);
    if (surviving.length) await tx.update(events).set({ revision: sql`${events.revision} + 1` }).where(inArray(events.id, surviving));
    const [deleted] = await tx.delete(user).where(eq(user.id, userID)).returning();
    return deleted;
  });
}

// DEV ONLY

export async function resetUsers() {
  if (config.api.environment === "dev") {
    const users = await db.select({ id: user.id }).from(user);
    let first: typeof user.$inferSelect | undefined;
    for (const row of users) {
      const deleted = await deleteUserWithCalendarRevisions(row.id);
      first ??= deleted;
    }
    return first;
  } else {
    throw new ForbiddenError(
      "This action is not possible in your environment...",
    );
  }
}

export async function userExists(userID: string) {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userID))
    .limit(1);
  return Boolean(row);
}

export async function getUserAvatar(userID: string) {
  const [row] = await db
    .select()
    .from(userAvatars)
    .where(eq(userAvatars.id, userID));
  return row ?? null;
}

export async function deleteUserAvatar(userID: string) {
  await db.delete(userAvatars).where(eq(userAvatars.id, userID));
}
