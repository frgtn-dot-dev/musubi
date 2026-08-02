import { and, eq, isNull } from "drizzle-orm";
import { db, events, eventShares, user } from "..";

// A share is the only thing that makes an event readable without a session, so
// every read here filters on `revokedAt IS NULL` — a revoked token is a dead
// token, not a slow one.

export type EventShareRow = typeof eventShares.$inferSelect;

export async function getEventShare(
  eventID: string,
): Promise<EventShareRow | undefined> {
  const [row] = await db
    .select()
    .from(eventShares)
    .where(and(eq(eventShares.eventID, eventID), isNull(eventShares.revokedAt)));
  return row;
}

/**
 * Publish an event, or change how it is published.
 *
 * The token survives a mode change on purpose: someone who has already sent the
 * link around should not have it broken because they ticked "indexable". Killing
 * the URL is what revoking is for, and it is a separate, deliberate act.
 */
export async function upsertEventShare(input: {
  createdBy: string;
  eventID: string;
  indexable: boolean;
  mode: string;
  token: string;
}): Promise<EventShareRow> {
  const existing = await getEventShare(input.eventID);

  if (existing) {
    const [updated] = await db
      .update(eventShares)
      .set({ indexable: input.indexable, mode: input.mode })
      .where(eq(eventShares.id, existing.id))
      .returning();
    return updated!;
  }

  const [created] = await db
    .insert(eventShares)
    .values({
      createdBy: input.createdBy,
      eventID: input.eventID,
      indexable: input.indexable,
      mode: input.mode,
      token: input.token,
    })
    .returning();
  return created!;
}

export async function revokeEventShare(eventID: string): Promise<boolean> {
  const revoked = await db
    .update(eventShares)
    .set({ revokedAt: new Date() })
    .where(and(eq(eventShares.eventID, eventID), isNull(eventShares.revokedAt)))
    .returning({ id: eventShares.id });
  return revoked.length > 0;
}

/**
 * The event behind a public token, with the organizer's display name.
 *
 * Joined here rather than in the handler so the public path is one query and
 * one place to audit: whatever this returns is what an anonymous reader can
 * see. Soft-deleted events are not found at all.
 */
export async function getSharedEvent(token: string) {
  const [row] = await db
    .select({
      description: events.description,
      end: events.end,
      indexable: eventShares.indexable,
      isAllDay: events.isAllDay,
      isCanceled: events.isCanceled,
      location: events.location,
      mode: eventShares.mode,
      organizerName: user.name,
      recurrence: events.recurrence,
      start: events.start,
      title: events.title,
      url: events.url,
    })
    .from(eventShares)
    .innerJoin(events, eq(events.id, eventShares.eventID))
    .innerJoin(user, eq(user.id, events.creatorID))
    .where(
      and(
        eq(eventShares.token, token),
        isNull(eventShares.revokedAt),
        // A deleted event has no page, even with a live token: the tombstone
        // stays for delta sync, the publication does not.
        isNull(events.deletedAt),
      ),
    );

  return row;
}
