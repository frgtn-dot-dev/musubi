import { and, eq, inArray } from "drizzle-orm";
import { db, dispatchCursors, pushSubscriptions } from "..";

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

/**
 * Remember a browser that agreed to be pushed to.
 *
 * Upsert on the endpoint, not insert: a browser that re-subscribes hands back
 * the endpoint it already had, and rotating its keys is a normal thing for it
 * to do. Re-granting permission must not leave two rows racing to deliver the
 * same reminder.
 *
 * The endpoint moves to whoever last proved they hold it — a shared computer
 * where a second person signs in and subscribes should push to them, not go on
 * announcing the first person's meetings.
 */
export async function savePushSubscription(input: {
  auth: string;
  endpoint: string;
  p256dh: string;
  userID: string;
}) {
  await db
    .insert(pushSubscriptions)
    .values(input)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        auth: input.auth,
        lastSeenAt: new Date(),
        p256dh: input.p256dh,
        userID: input.userID,
      },
    });
}

/** Unsubscribe. Scoped to the caller so one account cannot drop another's. */
export async function deletePushSubscription(userID: string, endpoint: string) {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userID, userID),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    );
}

/**
 * Endpoints the push service has told us are gone (404/410).
 *
 * By endpoint rather than by user: the same dead endpoint can only belong to
 * one row, and the send loop knows the endpoint, not who it was for.
 */
export async function deletePushSubscriptionsByEndpoint(endpoints: string[]) {
  if (endpoints.length === 0) return;
  await db
    .delete(pushSubscriptions)
    .where(inArray(pushSubscriptions.endpoint, endpoints));
}

export async function markPushSubscriptionsSeen(endpoints: string[]) {
  if (endpoints.length === 0) return;
  await db
    .update(pushSubscriptions)
    .set({ lastSeenAt: new Date() })
    .where(inArray(pushSubscriptions.endpoint, endpoints));
}

/**
 * Every subscription, grouped by the person it belongs to.
 *
 * The dispatcher works user by user — reminder rules, calendars and events are
 * all per person — so it needs the list in that shape, and only for people who
 * have somewhere to be pushed to.
 */
export async function getPushSubscriptionsByUser() {
  const rows = await db
    .select({
      auth: pushSubscriptions.auth,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      userID: pushSubscriptions.userID,
    })
    .from(pushSubscriptions)
    .orderBy(pushSubscriptions.userID);

  const byUser = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = byUser.get(row.userID);
    if (existing) existing.push(row);
    else byUser.set(row.userID, [row]);
  }
  return byUser;
}

/**
 * How far the reminder dispatcher has already looked.
 *
 * One cursor for the whole server, not one per user: it answers "which slice of
 * time has been dispatched", which is the same question whoever is asking. Kept
 * in its own table so it survives a restart — without it a bounce would either
 * re-send the last window or skip it.
 */
export async function getDispatchCursor(name: string): Promise<Date | null> {
  const [row] = await db
    .select({ value: dispatchCursors.value })
    .from(dispatchCursors)
    .where(eq(dispatchCursors.name, name));
  return row?.value ?? null;
}

export async function setDispatchCursor(name: string, at: Date) {
  await db
    .insert(dispatchCursors)
    .values({ name, value: at })
    .onConflictDoUpdate({ target: dispatchCursors.name, set: { value: at } });
}
