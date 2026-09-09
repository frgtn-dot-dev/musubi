import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
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
export async function getDuePendingNotifications(now: Date, ids?: string[]) {
  if (ids?.length === 0) return [];

  return db
    .select({
      // Queue payloads can outlive redaction or be inserted after its cleanup.
      // Evaluate current visibility and the exact native source at read time.
      eligible: sql<boolean>`${pendingNotifications.kind} <> 'event_changed' or exists (
        select 1 from events event
        where event.id::text = ${pendingNotifications.subjectID}
          and event.deleted_at is null
          and (event.creator_id = ${pendingNotifications.userID}
            or exists (select 1 from event_users attendee where attendee.event_id = event.id
              and attendee.user_id = ${pendingNotifications.userID})
            or exists (select 1 from calendar_events link
              join calendar_members member on member.calendar_id = link.calendar_id
              where link.event_id = event.id and member.user_id = ${pendingNotifications.userID}))
          and (not exists (select 1 from external_events mapping
              where mapping.event_id = event.id and mapping.calendar_id = event.origin_calendar_id
                and mapping.provider = 'google')
            and not exists (select 1 from external_calendars source
              where source.calendar_id = event.origin_calendar_id and source.provider = 'google')
            or exists (select 1 from external_events mapping
              join external_calendars source on source.calendar_id = mapping.calendar_id
                and source.external_calendar_id = mapping.external_calendar_id and source.provider = mapping.provider
              join calendar_members member on member.calendar_id = source.calendar_id and member.user_id = source.user_id
              join account connected on connected.account_id = source.account_id
                and connected.provider_id = source.provider and connected.user_id = source.user_id
              where mapping.event_id = event.id and mapping.calendar_id = event.origin_calendar_id
                and mapping.provider = 'google' and source.user_id = event.creator_id
                and source.disabled = false and source.supports_events = true
                and connected.sync_status = 'active' and member.role in ('owner', 'editor')
                and (source.provider_access_role in ('owner', 'writer')
                  or (source.provider_access_role is null and source.provider_access_revision = 0))
                and (source.provider_access_revision = 0 or nullif(source.cursor, '') is not null)
                and mapping.read_redaction_revision is null))
      )`,
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
    .where(and(lte(pendingNotifications.dueAt, now), ids ? inArray(pendingNotifications.id, ids) : undefined));
}

export async function deletePendingNotifications(ids: string[], delivered?: { id: string; payload: Record<string, unknown> }[]) {
  if (ids.length === 0 || delivered?.length === 0) return;
  await db
    .delete(pendingNotifications)
    .where(and(inArray(pendingNotifications.id, ids), delivered ? or(...delivered.map(row =>
      and(eq(pendingNotifications.id, row.id), sql`${pendingNotifications.payload} = ${JSON.stringify(row.payload)}::jsonb`),
    )) : undefined));
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
