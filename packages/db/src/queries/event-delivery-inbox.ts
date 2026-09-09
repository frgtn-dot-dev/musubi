import { and, asc, desc, eq, gt, or, sql } from "drizzle-orm";
import type { EventDeliveryInbox } from "@musubi/types";
import { db } from "..";
import { eventOutbox } from "../schema";
import { unresolvedEventOutbox } from "./event-outbox";

/** Discover retained deletes as well as live events after a client restart.
 * Google and Microsoft receipt titles follow the current source grant, including
 * retained deletes. CalDAV uses the current readable event title and its own
 * connected-account and current destination-link proof. Accepted payloads remain
 * private and immutable; only
 * this projection is redacted. Other providers retain saved-title behavior.
 * UUID keyset order stays stable when retries change updatedAt. Refresh begins
 * from the first page; this is a live list, not a cross-request snapshot. */
export async function getEventDeliveryInbox(
  userID: string,
  cursor?: string,
): Promise<EventDeliveryInbox> {
  const pageSize = 25;
  // Pre-discovery links (revision zero, null role) keep their established owner/
  // editor behavior. Once discovery has advanced the grant, a successful sync
  // cursor is required: role restoration alone must not reveal stale receipts.
  const rows = await db
    .selectDistinctOn([eventOutbox.eventID], {
      eventId: eventOutbox.eventID,
      // Explicit outer qualification survives Drizzle's single-table SELECT
      // normalization; bare column interpolation would bind inside EXISTS.
      savedTitle: sql<string>`case
        when event_outbox.provider not in ('google', 'microsoft', 'caldav') or exists (
          select 1 from external_calendars source
          inner join calendar_members member
            on member.calendar_id = source.calendar_id
            and member.user_id = source.user_id
          inner join account connected
            on connected.account_id = source.account_id
            and connected.provider_id = source.provider
            and connected.user_id = source.user_id
          where source.id = event_outbox.external_calendar_link_id
            and source.provider in ('google', 'microsoft')
            and source.provider = event_outbox.provider
            and source.user_id = event_outbox.user_id
            and source.account_id = event_outbox.account_id
            and source.external_calendar_id = event_outbox.external_calendar_id
            and source.calendar_id = event_outbox.calendar_id
            and source.disabled = false and source.supports_events = true
            and connected.sync_status = 'active'
            and (member.role in ('owner', 'editor') or (source.provider = 'microsoft' and member.role = 'viewer'))
            and ((source.provider = 'google' and source.provider_access_role in ('owner', 'writer'))
              or (source.provider = 'microsoft' and source.provider_access_role like 'microsoft:private=yes;%')
              or (source.provider_access_role is null and source.provider_access_revision = 0))
            and (source.provider_access_revision = 0 or nullif(source.cursor, '') is not null)
        ) or (event_outbox.provider = 'caldav' and exists (
          select 1 from external_calendars source
          join caldav_accounts connected on connected.id::text = source.account_id and connected.user_id = source.user_id
          join calendar_members member on member.calendar_id = source.calendar_id and member.user_id = source.user_id
          join events event on event.id = event_outbox.event_id
          join calendar_events visible on visible.event_id = event.id and visible.calendar_id = source.calendar_id
          where source.id = event_outbox.external_calendar_link_id
            and source.provider = 'caldav' and source.user_id = event_outbox.user_id
            and source.account_id = event_outbox.account_id and source.calendar_id = event_outbox.calendar_id
            and source.external_calendar_id = event_outbox.external_calendar_id
            and source.disabled = false and source.supports_events = true
            and (source.provider_access_role is null or source.provider_access_role not like 'caldav:read=no;%')
            and (event.provider_read_retired_revision is null or exists (
              select 1 from external_events mapping where mapping.event_id = event.id
                and mapping.calendar_id = source.calendar_id and mapping.provider = source.provider
                and mapping.external_calendar_id = source.external_calendar_id
                and mapping.read_redaction_revision is null and mapping.etag is not null))
        )) then case when event_outbox.provider = 'caldav'
          then (select event.name from events event where event.id = event_outbox.event_id)
          else event_outbox.payload->'event'->>'title' end
        else 'Calendar event' end`,
    })
    .from(eventOutbox)
    .where(
      and(
        eq(eventOutbox.userID, userID),
        sql`${eventOutbox.status} not in ('completed', 'not-needed')`,
        cursor ? gt(eventOutbox.eventID, cursor) : undefined,
        or(
          unresolvedEventOutbox(),
          // A disconnected/cancelled final attempt also needs to remain visible.
          // Superseded cancellations disappear once their replacement completes.
          and(
            eq(eventOutbox.status, "cancelled"),
            sql`not exists (
          select 1 from event_outbox newer
          where newer.event_id = ${eventOutbox.eventID}
            and newer.external_calendar_link_id = ${eventOutbox.externalCalendarLinkID}
            and (newer.revision, newer.created_at, newer.position, newer.id) >
              (${eventOutbox.revision}, ${eventOutbox.createdAt}, ${eventOutbox.position}, ${eventOutbox.id})
        )`,
          ),
        ),
      ),
    )
    .orderBy(
      eventOutbox.eventID,
      desc(eventOutbox.revision),
      desc(eventOutbox.createdAt),
      desc(eventOutbox.position),
      asc(eventOutbox.id),
    )
    .limit(pageSize + 1);
  const items = rows.slice(0, pageSize);
  return {
    items,
    nextCursor: rows.length > pageSize ? items[items.length - 1].eventId : null,
  };
}
