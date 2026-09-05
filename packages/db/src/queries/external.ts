import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { logger } from "@musubi/config";
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
import { hasProviderSyncScopes } from "./oauth";
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
  // Legacy reset helper: only the home calendar can tombstone shared content.
  // Keep links/mappings so authoritative upserts revive the SAME local ID.
  await db
    .update(events)
    .set({ deletedAt: new Date() })
    .where(eq(events.originCalendarID, calendarID));
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
    // Lock the event before its links, matching provider reconciliation.
    await touchEvent(tx, eventID);
    await linkEventToCalendarsInTransaction(tx, eventID, calendarIDs);
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

  // Remote collection IDs can be shared across accounts/providers. Scope the
  // removal to the actual local mirrors, just like calendar_events above.
  await tx
    .delete(externalEvents)
    .where(
      and(
        eq(externalEvents.eventID, eventID),
        inArray(externalEvents.calendarID, calendarIDs),
      ),
    );
}

export async function unlinkEventFromCalendars(
  eventID: string,
  calendarIDs: string[],
) {
  if (calendarIDs.length === 0) return;
  await db.transaction(async (tx) => {
    await touchEvent(tx, eventID);
    await unlinkEventFromCalendarsInTransaction(tx, eventID, calendarIDs);
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
    await touchEvent(tx, eventID);
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
    }

    return { remaining, removed };
  });
}

// Lock shared content before mapping/link rows, just like local mutations.
// Re-read the mapping after waiting: another unlink may have removed it while
// the first SELECT's snapshot still contained it.
async function mappedEventForUpdate(
  tx: DbTransaction,
  provider: string,
  calendarID: string,
  externalEventID: string,
) {
  const [mapped] = await tx
    .select({ id: externalEvents.id, event: events })
    .from(externalEvents)
    .innerJoin(events, eq(externalEvents.eventID, events.id))
    .where(
      and(
        eq(externalEvents.provider, provider),
        eq(externalEvents.calendarID, calendarID),
        eq(externalEvents.externalEventID, externalEventID),
      ),
    )
    .for("update", { of: events });
  if (!mapped) return undefined;
  const [mapping] = await tx
    .select()
    .from(externalEvents)
    .where(eq(externalEvents.id, mapped.id))
    .for("update");
  return mapping ? { ...mapping, event: mapped.event } : undefined;
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
    const map = await mappedEventForUpdate(
      tx,
      provider,
      calendarID,
      externalEventID,
    );

    if (map) {
      if (etag !== null && map.etag === etag && map.event.deletedAt === null)
        return false;
      if (map.event.originCalendarID !== calendarID) {
        const changedFields = (
          Object.keys(values) as (keyof EventValues)[]
        ).filter((key) => {
          // Mirror color is presentation, not provider event content.
          if (key === "color") return false;
          const incoming = values[key];
          const current = map.event[key];
          return incoming instanceof Date && current instanceof Date
            ? incoming.getTime() !== current.getTime()
            : incoming !== current;
        });
        // A linked copy is not a second writer, even when the same user owns
        // both calendars. Unknown legacy origins must also fail closed. Leave
        // its old ETag intact: rejecting content must not acknowledge it for a
        // later conditional write. Log field names only, never provider data.
        if (changedFields.length || map.event.deletedAt !== null) {
          logger.warn("sync.event.non_origin_update_rejected", {
            provider,
            calendarId: calendarID,
            eventId: map.event.id,
            originCalendarId: map.event.originCalendarID,
            changedFields,
          });
        }
        return false;
      }
      // Only the authoritative mirror can change or revive shared content.
      await tx
        .update(events)
        .set({ ...values, deletedAt: null })
        .where(eq(events.id, map.event.id));
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
 * A provider deletion is authoritative only in the event's home calendar.
 * Other copies lose their own link/mapping, never the shared event. Returns
 * TRUE for an actual unlink or tombstone; repeated deletions are no-ops.
 */
export async function deleteExternalEvent(
  provider: string,
  calendarID: string,
  externalEventID: string,
  onUnlink?: (eventID: string) => void,
): Promise<boolean> {
  let unlinkedEventID: string | undefined;
  const changed = await db.transaction(async (tx) => {
    const mapped = await mappedEventForUpdate(
      tx,
      provider,
      calendarID,
      externalEventID,
    );
    if (!mapped) return false;

    if (mapped.event.originCalendarID !== calendarID) {
      await unlinkEventFromCalendarsInTransaction(tx, mapped.event.id, [
        calendarID,
      ]);
      await touchEvent(tx, mapped.event.id);
      unlinkedEventID = mapped.event.id;
      return true;
    }
    if (mapped.event.deletedAt !== null) return false;
    // Retain authoritative mappings/links for tombstone deltas and revival.
    await tx
      .update(events)
      .set({ deletedAt: new Date() })
      .where(eq(events.id, mapped.event.id));
    return true;
  });
  // Emit receipts only after commit, never for rolled-back link changes.
  if (unlinkedEventID) onUnlink?.(unlinkedEventID);
  return changed;
}

/** Reconcile a complete snapshot using the same authority rules as delta deletes. */
export async function sweepExternalEvents(
  provider: string,
  calendarID: string,
  seenExternalEventIDs: string[],
  onUnlink?: (eventID: string) => void,
): Promise<number> {
  const mappings = await db
    .select({
      externalEventID: externalEvents.externalEventID,
    })
    .from(externalEvents)
    .where(
      and(
        eq(externalEvents.provider, provider),
        eq(externalEvents.calendarID, calendarID),
      ),
    );
  const seen = new Set(seenExternalEventIDs);
  let changed = 0;
  // ponytail: one transaction per missing resource; batch only if large reset
  // sweeps are measurably slow. Delta and reset must share deletion semantics.
  for (const mapping of mappings) {
    if (
      !seen.has(mapping.externalEventID) &&
      (await deleteExternalEvent(
        provider,
        calendarID,
        mapping.externalEventID,
        onUnlink,
      ))
    )
      changed++;
  }
  return changed;
}

/** Include connected accounts before their first mirror exists. */
export async function getExternalSyncUserIDs(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userID: externalCalendars.userID })
    .from(externalCalendars);
  const caldav = await db.selectDistinct({ userID: caldavAccounts.userID }).from(caldavAccounts);
  const oauth = await db.select({
    userID: account.userId,
    provider: account.providerId,
    scope: account.scope,
    refreshToken: account.refreshToken,
    syncStatus: account.syncStatus,
    syncErrorCode: account.syncErrorCode,
  }).from(account).where(inArray(account.providerId, ["google", "microsoft"]));
  const eligible = oauth.filter((row) => row.refreshToken &&
    hasProviderSyncScopes(row.provider, row.scope ?? "") &&
    (row.syncStatus === "active" ||
      (row.syncStatus === "reconnect_required" && row.syncErrorCode === "insufficient_scope")));
  return [...new Set([...rows, ...caldav, ...eligible].map((row) => row.userID))];
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
