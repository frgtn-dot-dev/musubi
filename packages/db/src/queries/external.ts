import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  caldavAccounts,
  account,
  calendarEvents,
  calendarMembers,
  calendars,
  db,
  events,
  externalCalendars,
  externalEvents,
  externalTasks,
  tasks,
  type NewEvent,
  type NewTask,
} from "..";
import { type DbTransaction, removeCalendarInTransaction } from "./calendars";

// Column values written to the `events` row for a synced event.
type EventValues = {
  title: string;
  color: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  description: string | null;
  location: string | null;
  organizer: string;
  recurrence: string | null;
  url: string | null;
};

type TaskValues = {
  title: string;
  description: string | null;
  status: NonNullable<NewTask["status"]>;
  start: Date | null;
  due: Date | null;
  isAllDay: boolean;
  completedAt: Date | null;
  percentComplete: number;
  priority: number;
  recurrence: string | null;
  relatedTo: string | null;
  sequence: number;
  url: string | null;
};

// --- calendars ---

export async function getUserExternalCalendars(
  provider: string,
  userID: string,
  accountID: string,
) {
  return db
    .select({
      // From the joined calendars row so the type is non-null — the inner join
      // already excludes disabled tombstones (calendarID null).
      calendarID: calendars.id,
      externalCalendarID: externalCalendars.externalCalendarID,
      cursor: externalCalendars.cursor,
      supportsEvents: externalCalendars.supportsEvents,
      supportsTasks: externalCalendars.supportsTasks,
      calColor: calendars.color,
    })
    .from(externalCalendars)
    .innerJoin(calendars, eq(externalCalendars.calendarID, calendars.id))
    .where(
      and(
        eq(externalCalendars.provider, provider),
        eq(externalCalendars.userID, userID),
        eq(externalCalendars.accountID, accountID),
      ),
    );
}

export async function importExternalCalendar(
  provider: string,
  userID: string,
  accountID: string,
  accountLabel: string,
  cal: {
    externalId: string;
    name: string;
    color: string;
    supportsEvents?: boolean;
    supportsTasks?: boolean;
  },
  role: string = "owner", // "viewer" for provider-side read-only calendars (holidays, …)
) {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(calendars)
      .values({ creatorID: userID, name: cal.name, color: cal.color })
      .returning();
    await tx.insert(externalCalendars).values({
      provider,
      userID,
      accountID,
      accountLabel,
      calendarID: created.id,
      externalCalendarID: cal.externalId,
      cursor: null,
      supportsEvents: cal.supportsEvents ?? true,
      supportsTasks: cal.supportsTasks ?? false,
    });
    await tx
      .insert(calendarMembers)
      .values({ userID, calendarID: created.id, role });
    return created;
  });
}

// External calendars the user opted OUT of syncing (mirror deleted, tombstone
// kept). Discovery consults this to avoid re-importing them on the next sync.
export async function getDisabledExternalCalendarIDs(
  provider: string,
  userID: string,
  accountID: string,
) {
  const rows = await db
    .select({ externalCalendarID: externalCalendars.externalCalendarID })
    .from(externalCalendars)
    .where(
      and(
        eq(externalCalendars.provider, provider),
        eq(externalCalendars.userID, userID),
        eq(externalCalendars.accountID, accountID),
        eq(externalCalendars.disabled, true),
      ),
    );
  return rows.map((r) => r.externalCalendarID);
}

// Opt a single external calendar out of sync without disconnecting the whole
// account. Detaches the FK BEFORE deleting the mirror so the cascade can't take
// the tombstone row with it; returns null if the calendar isn't an external
// mirror owned by this user.
export async function disableExternalCalendar(
  userID: string,
  calendarID: string,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(externalCalendars)
      .set({ disabled: true, calendarID: null, cursor: null })
      .where(
        and(
          eq(externalCalendars.calendarID, calendarID),
          eq(externalCalendars.userID, userID),
        ),
      )
      .returning({ id: externalCalendars.id });
    if (!row) return null;
    await removeCalendarInTransaction(tx, calendarID);
    return row;
  });
}

// Remove every local mirror for one provider account as a single database unit.
// OAuth unlink/revocation still happens outside PostgreSQL; CalDAV credentials
// are local, so they can be deleted in this transaction too.
export async function removeExternalAccountData(
  provider: string,
  userID: string,
  accountID: string,
) {
  return db.transaction(async (tx) => {
    const links = await tx
      .select({ calendarID: calendars.id })
      .from(externalCalendars)
      .innerJoin(calendars, eq(externalCalendars.calendarID, calendars.id))
      .where(
        and(
          eq(externalCalendars.provider, provider),
          eq(externalCalendars.userID, userID),
          eq(externalCalendars.accountID, accountID),
        ),
      );

    for (const link of links) {
      await removeCalendarInTransaction(tx, link.calendarID);
    }

    // Live rows cascade with their calendars; this also removes disabled
    // tombstones so reconnecting the account starts from a clean slate.
    await tx
      .delete(externalCalendars)
      .where(
        and(
          eq(externalCalendars.provider, provider),
          eq(externalCalendars.userID, userID),
          eq(externalCalendars.accountID, accountID),
        ),
      );

    if (provider === "caldav") {
      await tx
        .delete(caldavAccounts)
        .where(
          and(
            eq(caldavAccounts.id, accountID),
            eq(caldavAccounts.userID, userID),
          ),
        );
    }

    return links.map((link) => link.calendarID);
  });
}

// Keep the account label fresh across all of an account's calendars.
export async function setAccountLabel(
  provider: string,
  userID: string,
  accountID: string,
  accountLabel: string,
) {
  await db
    .update(externalCalendars)
    .set({ accountLabel })
    .where(
      and(
        eq(externalCalendars.provider, provider),
        eq(externalCalendars.userID, userID),
        eq(externalCalendars.accountID, accountID),
      ),
    );
}

export async function setExternalCalendarCapabilities(
  provider: string,
  userID: string,
  accountID: string,
  externalCalendarID: string,
  capabilities: { supportsEvents: boolean; supportsTasks: boolean },
) {
  await db
    .update(externalCalendars)
    .set(capabilities)
    .where(
      and(
        eq(externalCalendars.provider, provider),
        eq(externalCalendars.userID, userID),
        eq(externalCalendars.accountID, accountID),
        eq(externalCalendars.externalCalendarID, externalCalendarID),
      ),
    );
}

export async function setCursor(calendarID: string, cursor: string | null) {
  await db
    .update(externalCalendars)
    .set({ cursor })
    .where(eq(externalCalendars.calendarID, calendarID));
}

// For push: given a Musubi calendar, which provider/external calendar/user backs it.
// serverUrl (caldav only) lets the client tell Apple/iCloud apart from generic CalDAV.
export async function getExternalLinkForCalendar(calendarID: string) {
  const [res] = await db
    .select({
      provider: externalCalendars.provider,
      externalCalendarID: externalCalendars.externalCalendarID,
      supportsEvents: externalCalendars.supportsEvents,
      supportsTasks: externalCalendars.supportsTasks,
      userID: externalCalendars.userID,
      accountID: externalCalendars.accountID,
      accountLabel: externalCalendars.accountLabel,
      serverUrl: caldavAccounts.serverUrl,
      syncStatus: account.syncStatus,
      syncErrorCode: account.syncErrorCode,
    })
    .from(externalCalendars)
    .leftJoin(
      caldavAccounts,
      eq(externalCalendars.accountID, sql`${caldavAccounts.id}::text`),
    )
    .leftJoin(
      account,
      and(
        eq(externalCalendars.provider, account.providerId),
        eq(externalCalendars.userID, account.userId),
        eq(externalCalendars.accountID, account.accountId),
      ),
    )
    .where(eq(externalCalendars.calendarID, calendarID));
  return res ?? null;
}

// --- events ---

export async function clearCalendarEvents(calendarID: string) {
  // Soft-delete (tombstone) so the delta tells clients to drop them, and keep
  // the external_events mapping — a following upsert revives still-present events
  // with the SAME id (no churn); genuinely-gone ones stay tombstoned.
  await db
    .update(events)
    .set({ deletedAt: new Date() })
    .where(
      inArray(
        events.id,
        db
          .select({ id: calendarEvents.eventID })
          .from(calendarEvents)
          .where(eq(calendarEvents.calendarID, calendarID)),
      ),
    );
}

async function linkEventToCalendarsInTransaction(
  tx: DbTransaction,
  eventID: string,
  calendarIDs: string[],
) {
  if (calendarIDs.length === 0) return;
  await tx
    .insert(calendarEvents)
    .values(calendarIDs.map((c) => ({ eventID, calendarID: c })))
    .onConflictDoNothing({
      target: [calendarEvents.eventID, calendarEvents.calendarID],
    });
}

// Delta sync filters on events.updatedAt, so link/unlink must bump the event row —
// otherwise offline members never learn the event's calendar membership changed.
async function touchEvent(tx: DbTransaction, eventID: string) {
  await tx
    .update(events)
    .set({ updatedAt: new Date() })
    .where(eq(events.id, eventID));
}

// Link an event into calendars (calendar_events rows). The added diff normally
// contains only new links; the constraint + conflict handling also absorb
// retries and concurrent requests. The link set and delta timestamp move
// together.
export async function linkEventToCalendars(
  eventID: string,
  calendarIDs: string[],
) {
  if (calendarIDs.length === 0) return;
  await db.transaction(async (tx) => {
    await linkEventToCalendarsInTransaction(tx, eventID, calendarIDs);
    await touchEvent(tx, eventID);
  });
}

// Unlink an event from calendars: drop the calendar_events rows AND any external
// mapping for those calendars, so re-adding later pushes a fresh external event
// instead of updating a stale (possibly deleted) one.
async function unlinkEventFromCalendarsInTransaction(
  tx: DbTransaction,
  eventID: string,
  calendarIDs: string[],
) {
  if (calendarIDs.length === 0) return;
  await tx
    .delete(calendarEvents)
    .where(
      and(
        eq(calendarEvents.eventID, eventID),
        inArray(calendarEvents.calendarID, calendarIDs),
      ),
    );

  const extCals = await tx
    .select({ ext: externalCalendars.externalCalendarID })
    .from(externalCalendars)
    .where(inArray(externalCalendars.calendarID, calendarIDs));
  const extIDs = extCals.map((e) => e.ext);
  if (extIDs.length) {
    await tx
      .delete(externalEvents)
      .where(
        and(
          eq(externalEvents.eventID, eventID),
          inArray(externalEvents.externalCalendarID, extIDs),
        ),
      );
  }
}

export async function unlinkEventFromCalendars(
  eventID: string,
  calendarIDs: string[],
) {
  if (calendarIDs.length === 0) return;
  await db.transaction(async (tx) => {
    await unlinkEventFromCalendarsInTransaction(tx, eventID, calendarIDs);
    await touchEvent(tx, eventID);
  });
}

// Persist an event edit and reconcile every local link/mapping as one unit.
// Provider deletes happen before this call while their mapping is still present;
// provider creates/updates happen afterwards and remain best-effort.
export async function updateEventAndCalendarLinks(
  event: Partial<NewEvent> & { id: string },
  addedCalendarIDs: string[],
  removedCalendarIDs: string[],
) {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(events)
      .set(event)
      .where(eq(events.id, event.id))
      .returning();
    if (!updated) return undefined;

    await unlinkEventFromCalendarsInTransaction(
      tx,
      event.id,
      removedCalendarIDs,
    );
    await linkEventToCalendarsInTransaction(tx, event.id, addedCalendarIDs);
    return updated;
  });
}

// Delete a selected set of links and tombstone the event iff that leaves it
// orphaned. The returned link set is from the same transaction.
export async function unlinkEventAndTombstoneIfOrphaned(
  eventID: string,
  calendarIDs: string[],
) {
  return db.transaction(async (tx) => {
    await unlinkEventFromCalendarsInTransaction(tx, eventID, calendarIDs);

    const rows = await tx
      .select({ calendarID: calendarEvents.calendarID })
      .from(calendarEvents)
      .where(eq(calendarEvents.eventID, eventID));
    const remaining = rows.map((row) => row.calendarID);
    const removed = remaining.length === 0;

    if (removed) {
      await tx
        .update(events)
        .set({ deletedAt: new Date() })
        .where(eq(events.id, eventID));
    } else {
      await touchEvent(tx, eventID);
    }

    return { remaining, removed };
  });
}

/**
 * Upsert a provider event. Returns TRUE when it actually wrote something —
 * the scheduled sync uses this to decide whether to wake connected clients.
 * With an etag (CalDAV) an unchanged, alive event is a verified no-op: no
 * write, no updatedAt bump, so the delta stays quiet too.
 */
export async function upsertExternalEvent(
  provider: string,
  userID: string,
  calendarID: string,
  externalCalendarID: string,
  externalEventID: string,
  values: EventValues,
  etag: string | null = null,
  icalUid: string | null = null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [map] = await tx
      .select({
        id: externalEvents.id,
        eventID: externalEvents.eventID,
        etag: externalEvents.etag,
        icalUid: externalEvents.icalUid,
        deletedAt: events.deletedAt,
      })
      .from(externalEvents)
      .innerJoin(events, eq(externalEvents.eventID, events.id))
      .where(
        and(
          eq(externalEvents.provider, provider),
          // scope to THIS mirror — global calendars (Google holidays) share
          // externalCalendarID across every user's account
          eq(externalEvents.calendarID, calendarID),
          eq(externalEvents.externalEventID, externalEventID),
        ),
      );

    if (map) {
      // etag match on a live event = nothing changed (CalDAV full-fetches
      // everything every sync; without this check every poll looks "changed")
      if (etag !== null && map.etag === etag && map.deletedAt === null)
        return false;
      // revive if it was tombstoned by a reset
      await tx
        .update(events)
        .set({ ...values, deletedAt: null })
        .where(eq(events.id, map.eventID));
      await tx
        .update(externalEvents)
        .set({ etag, icalUid: icalUid ?? map.icalUid })
        .where(eq(externalEvents.id, map.id));
    } else {
      const [ev] = await tx
        .insert(events)
        // Home calendar = the mirror it was imported into (matches createEvent's
        // rule) — drives the origin star + edit-permission gating.
        .values({
          id: crypto.randomUUID(),
          ...values,
          creatorID: userID,
          originCalendarID: calendarID,
        })
        .returning();
      await tx.insert(calendarEvents).values({ eventID: ev.id, calendarID });
      await tx.insert(externalEvents).values({
        provider,
        eventID: ev.id,
        calendarID,
        externalCalendarID,
        externalEventID,
        etag,
        icalUid,
      });
    }
    return true;
  });
}

/**
 * Provider says an event is gone. TOMBSTONE it (deletedAt) rather than hard
 * delete — the delta sync's `deletedIds` needs the tombstone to tell offline
 * clients to drop it (a hard delete just vanished and stale caches kept it).
 * Returns TRUE when a live event was actually tombstoned.
 */
export async function deleteExternalEvent(
  provider: string,
  calendarID: string,
  externalEventID: string,
): Promise<boolean> {
  const rows = await db
    .update(events)
    .set({ deletedAt: new Date() })
    .where(
      and(
        isNull(events.deletedAt),
        inArray(
          events.id,
          db
            .select({ id: externalEvents.eventID })
            .from(externalEvents)
            .where(
              and(
                eq(externalEvents.provider, provider),
                // scoped to the caller's mirror — never reach into another user's mirror
                eq(externalEvents.calendarID, calendarID),
                eq(externalEvents.externalEventID, externalEventID),
              ),
            ),
        ),
      ),
    )
    .returning({ id: events.id });
  return rows.length > 0;
}

/**
 * Full-fetch reconciliation (CalDAV every sync, Google after a 410 reset):
 * tombstone the mirror's events whose external id was NOT in the fetched set —
 * they were deleted on the provider. Replaces the old tombstone-everything-
 * then-revive approach, which churned every event on every sync and made
 * "did anything change" undetectable. Returns the number tombstoned.
 */
export async function sweepExternalEvents(
  provider: string,
  calendarID: string,
  seenExternalEventIDs: string[],
): Promise<number> {
  const mappings = await db
    .select({
      eventID: externalEvents.eventID,
      externalEventID: externalEvents.externalEventID,
    })
    .from(externalEvents)
    .innerJoin(events, eq(externalEvents.eventID, events.id))
    .where(
      and(
        eq(externalEvents.provider, provider),
        eq(externalEvents.calendarID, calendarID),
        isNull(events.deletedAt),
      ),
    );
  const seen = new Set(seenExternalEventIDs);
  const gone = mappings
    .filter((m) => !seen.has(m.externalEventID))
    .map((m) => m.eventID);
  if (gone.length === 0) return 0;
  await db
    .update(events)
    .set({ deletedAt: new Date() })
    .where(inArray(events.id, gone));
  return gone.length;
}

/** Users with at least one provider mirror — the scheduled sync's work list. */
export async function getExternalSyncUserIDs(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userID: externalCalendars.userID })
    .from(externalCalendars);
  return rows.map((r) => r.userID);
}

// For push update/delete: find the external id of an already-synced Musubi event.
export async function upsertExternalTask(
  provider: string,
  userID: string,
  calendarID: string,
  externalCalendarID: string,
  externalTaskID: string,
  values: TaskValues,
  etag: string | null = null,
  icalUid: string | null = null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [mapping] = await tx
      .select({
        id: externalTasks.id,
        taskID: externalTasks.taskID,
        etag: externalTasks.etag,
        icalUid: externalTasks.icalUid,
        deletedAt: tasks.deletedAt,
      })
      .from(externalTasks)
      .innerJoin(tasks, eq(externalTasks.taskID, tasks.id))
      .where(
        and(
          eq(externalTasks.provider, provider),
          eq(externalTasks.calendarID, calendarID),
          eq(externalTasks.externalTaskID, externalTaskID),
        ),
      );

    if (mapping) {
      if (etag !== null && mapping.etag === etag && mapping.deletedAt === null)
        return false;
      await tx
        .update(tasks)
        .set({ ...values, deletedAt: null })
        .where(eq(tasks.id, mapping.taskID));
      await tx
        .update(externalTasks)
        .set({ etag, icalUid: icalUid ?? mapping.icalUid })
        .where(eq(externalTasks.id, mapping.id));
    } else {
      const [task] = await tx
        .insert(tasks)
        .values({
          id: crypto.randomUUID(),
          creatorID: userID,
          calendarID,
          ...values,
        })
        .returning({ id: tasks.id });
      await tx.insert(externalTasks).values({
        provider,
        taskID: task.id,
        calendarID,
        externalCalendarID,
        externalTaskID,
        etag,
        icalUid,
      });
    }
    return true;
  });
}

export async function deleteExternalTask(
  provider: string,
  calendarID: string,
  externalTaskID: string,
): Promise<boolean> {
  const rows = await db
    .update(tasks)
    .set({ deletedAt: new Date() })
    .where(
      and(
        isNull(tasks.deletedAt),
        inArray(
          tasks.id,
          db
            .select({ id: externalTasks.taskID })
            .from(externalTasks)
            .where(
              and(
                eq(externalTasks.provider, provider),
                eq(externalTasks.calendarID, calendarID),
                eq(externalTasks.externalTaskID, externalTaskID),
              ),
            ),
        ),
      ),
    )
    .returning({ id: tasks.id });
  return rows.length > 0;
}

export async function sweepExternalTasks(
  provider: string,
  calendarID: string,
  seenExternalTaskIDs: string[],
): Promise<number> {
  const mappings = await db
    .select({
      taskID: externalTasks.taskID,
      externalTaskID: externalTasks.externalTaskID,
    })
    .from(externalTasks)
    .innerJoin(tasks, eq(externalTasks.taskID, tasks.id))
    .where(
      and(
        eq(externalTasks.provider, provider),
        eq(externalTasks.calendarID, calendarID),
        isNull(tasks.deletedAt),
      ),
    );
  const seen = new Set(seenExternalTaskIDs);
  const gone = mappings
    .filter((mapping) => !seen.has(mapping.externalTaskID))
    .map((mapping) => mapping.taskID);
  if (gone.length === 0) return 0;
  await db
    .update(tasks)
    .set({ deletedAt: new Date() })
    .where(inArray(tasks.id, gone));
  return gone.length;
}

export async function getExternalEvent(
  provider: string,
  eventID: string,
  externalCalendarID: string,
) {
  const [res] = await db
    .select({
      externalEventId: externalEvents.externalEventID,
      etag: externalEvents.etag,
      icalUid: externalEvents.icalUid,
    })
    .from(externalEvents)
    .where(
      and(
        eq(externalEvents.provider, provider),
        eq(externalEvents.eventID, eventID),
        eq(externalEvents.externalCalendarID, externalCalendarID),
      ),
    );
  return res ?? null;
}

export async function setExternalEventSyncData(
  provider: string,
  eventID: string,
  externalCalendarID: string,
  data: { etag: string | null; icalUid: string | null },
) {
  await db
    .update(externalEvents)
    .set(data)
    .where(
      and(
        eq(externalEvents.provider, provider),
        eq(externalEvents.eventID, eventID),
        eq(externalEvents.externalCalendarID, externalCalendarID),
      ),
    );
}

// For push create: store the mapping after the provider returns the new id.
export async function importExternalEvent(
  provider: string,
  eventID: string,
  calendarID: string,
  externalCalendarID: string,
  externalEventID: string,
  etag: string | null = null,
  icalUid: string | null = null,
) {
  await db.insert(externalEvents).values({
    provider,
    eventID,
    calendarID,
    externalCalendarID,
    externalEventID,
    etag,
    icalUid,
  });
}

export async function getExternalTask(
  provider: string,
  taskID: string,
  externalCalendarID: string,
) {
  const [result] = await db
    .select({
      externalTaskId: externalTasks.externalTaskID,
      etag: externalTasks.etag,
      icalUid: externalTasks.icalUid,
    })
    .from(externalTasks)
    .where(
      and(
        eq(externalTasks.provider, provider),
        eq(externalTasks.taskID, taskID),
        eq(externalTasks.externalCalendarID, externalCalendarID),
      ),
    );
  return result ?? null;
}

export async function setExternalTaskSyncData(
  provider: string,
  taskID: string,
  externalCalendarID: string,
  data: { etag: string | null; icalUid: string | null },
) {
  await db
    .update(externalTasks)
    .set(data)
    .where(
      and(
        eq(externalTasks.provider, provider),
        eq(externalTasks.taskID, taskID),
        eq(externalTasks.externalCalendarID, externalCalendarID),
      ),
    );
}

export async function importExternalTask(
  provider: string,
  taskID: string,
  calendarID: string,
  externalCalendarID: string,
  externalTaskID: string,
  etag: string | null = null,
  icalUid: string | null = null,
) {
  await db.insert(externalTasks).values({
    provider,
    taskID,
    calendarID,
    externalCalendarID,
    externalTaskID,
    etag,
    icalUid,
  });
}
