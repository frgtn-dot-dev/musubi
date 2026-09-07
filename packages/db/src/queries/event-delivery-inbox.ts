import { and, asc, desc, eq, gt, or, sql } from "drizzle-orm";
import type { EventDeliveryInbox } from "@musubi/types";
import { db } from "..";
import { eventOutbox } from "../schema";
import { unresolvedEventOutbox } from "./event-outbox";

/** Discover retained deletes as well as live events after a client restart.
 * Ownership of a receipt grants access to its saved title, not future content
 * of an event that may since have moved into somebody else's private calendar.
 * UUID keyset order stays stable when retries change updatedAt. Refresh begins
 * from the first page; this is a live list, not a cross-request snapshot. */
export async function getEventDeliveryInbox(
  userID: string,
  cursor?: string,
): Promise<EventDeliveryInbox> {
  const pageSize = 25;
  const rows = await db
    .selectDistinctOn([eventOutbox.eventID], {
      eventId: eventOutbox.eventID,
      savedTitle: sql<string>`${eventOutbox.payload}->'event'->>'title'`,
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
