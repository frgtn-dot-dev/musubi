import { and, eq, inArray, lte } from "drizzle-orm";
import { db, pendingNotifications, user, userSettings } from "..";

export type PendingNotificationRow = typeof pendingNotifications.$inferSelect;

/**
 * Line one person up for an email, without sending twenty.
 *
 * The upsert is what does the collapsing: a second change to the same event
 * replaces the payload and leaves `dueAt` where it was, so the email still goes
 * out on schedule and describes the latest state rather than the first.
 */
export async function queuePendingNotification(input: {
  dueAt: Date;
  kind: string;
  payload: Record<string, unknown>;
  subjectID: string;
  userID: string;
}) {
  await db
    .insert(pendingNotifications)
    .values(input)
    .onConflictDoUpdate({
      target: [
        pendingNotifications.userID,
        pendingNotifications.kind,
        pendingNotifications.subjectID,
      ],
      // Deliberately not `dueAt`: the clock started with the first change.
      set: { payload: input.payload },
    });
}

/**
 * Everything ripe, with the address and preferences to decide what to do.
 *
 * Joined rather than fetched per row: a drain that looks up a user's settings
 * once per queued event would issue a query per notification, and the whole
 * point of batching is that there can be a lot of them.
 */
export async function getDuePendingNotifications(now: Date) {
  return db
    .select({
      dueAt: pendingNotifications.dueAt,
      email: user.email,
      id: pendingNotifications.id,
      kind: pendingNotifications.kind,
      name: user.name,
      notificationEmails: userSettings.notificationEmails,
      payload: pendingNotifications.payload,
      subjectID: pendingNotifications.subjectID,
      timezone: userSettings.timezone,
      userID: pendingNotifications.userID,
    })
    .from(pendingNotifications)
    .innerJoin(user, eq(user.id, pendingNotifications.userID))
    // LEFT, not inner: a settings row is only materialized on first read, so an
    // account that has never opened settings has none. An inner join would drop
    // those people silently and forever, not merely until they look. Null here
    // means "no preference expressed", which the caller reads as the defaults.
    .leftJoin(userSettings, eq(userSettings.id, pendingNotifications.userID))
    .where(lte(pendingNotifications.dueAt, now));
}

export async function deletePendingNotifications(ids: string[]) {
  if (ids.length === 0) return;
  await db
    .delete(pendingNotifications)
    .where(inArray(pendingNotifications.id, ids));
}

/** Drop a queued notification that events overtook — the event was deleted. */
export async function dropPendingNotificationsFor(kind: string, subjectID: string) {
  await db
    .delete(pendingNotifications)
    .where(
      and(
        eq(pendingNotifications.kind, kind),
        eq(pendingNotifications.subjectID, subjectID),
      ),
    );
}
