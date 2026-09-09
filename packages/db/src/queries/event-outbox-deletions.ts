import { and, eq, sql } from "drizzle-orm";
import { db } from "..";
import {
  eventOutbox,
  events,
  externalCalendars,
  externalEventTombstones,
} from "../schema";
import type { DbTransaction } from "./calendars";
import type { EventOutboxRow } from "./event-outbox";

/** Resource identity fence precedes the event lock. It serializes an unmapped
 * delete observation with the transaction that first accepts its create ACK. */
export async function lockExternalEventIdentity(
  tx: DbTransaction,
  linkID: string,
  externalEventID: string,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
    ${JSON.stringify(["musubi:external-event", linkID.toLowerCase(), externalEventID])}, 0))`);
}

export async function lockExternalEventAddress(
  tx: DbTransaction,
  provider: string,
  calendarID: string,
  externalEventID: string,
) {
  const [target] = await tx
    .select({ id: externalCalendars.id })
    .from(externalCalendars)
    .where(
      and(
        eq(externalCalendars.provider, provider),
        eq(externalCalendars.calendarID, calendarID),
      ),
    );
  if (target) await lockExternalEventIdentity(tx, target.id, externalEventID);
}

export async function getEventOutboxDeletion(
  row: EventOutboxRow,
  externalEventID: string,
) {
  const [observed] = await db
    .select()
    .from(externalEventTombstones)
    .where(
      and(
        eq(
          externalEventTombstones.externalCalendarLinkID,
          row.externalCalendarLinkID,
        ),
        eq(externalEventTombstones.externalEventID, externalEventID),
      ),
    );
  return observed;
}

/** Called inside the pull transaction even when create ACK has no mapping yet.
 * Graph may supply only an opaque tombstone ID; retain it independently so a
 * later recovery/ACK can still detect the intervening remote deletion. */
export async function retainUnmappedEventDeletion(
  tx: DbTransaction,
  provider: string,
  calendarID: string,
  externalEventID: string,
) {
  const [target] = await tx
    .select()
    .from(externalCalendars)
    .where(
      and(
        eq(externalCalendars.provider, provider),
        eq(externalCalendars.calendarID, calendarID),
        eq(externalCalendars.disabled, false),
      ),
    );
  if (!target) return;
  const candidates = await tx
    .select()
    .from(eventOutbox)
    .where(
      and(
        eq(eventOutbox.externalCalendarLinkID, target.id),
        eq(eventOutbox.action, "create"),
        sql`${eventOutbox.status} not in ('completed', 'not-needed', 'cancelled')`,
        sql`(${eventOutbox.resultRef}->>'externalEventId' = ${externalEventID}
      or ${eventOutbox.remoteSnapshot}->>'externalEventId' = ${externalEventID}
      or (${eventOutbox.provider} = 'google' and 'musubi' || replace(${eventOutbox.id}::text, '-', '') = ${externalEventID})
      or (${eventOutbox.provider} = 'caldav' and rtrim(${eventOutbox.externalCalendarID}, '/') || '/musubi-' || ${eventOutbox.id}::text || '.ics' = ${externalEventID}))`,
      ),
    );
  // A delayed delta for our confirmed resource deletion is already represented
  // by its durable receipt. Do not leave an address tombstone that would block a
  // later incarnation. A new unresolved create still needs the existing fence.
  if (!candidates.length) {
    const resourceID = provider === "caldav" ? externalEventID.split("#musubi-original=")[0]! : externalEventID;
    const [completed] = await tx.select({ id: eventOutbox.id }).from(eventOutbox).where(and(
      eq(eventOutbox.provider, provider), eq(eventOutbox.userID, target.userID), eq(eventOutbox.calendarID, calendarID), eq(eventOutbox.externalEventID, resourceID),
      eq(eventOutbox.externalCalendarLinkID, target.id), eq(eventOutbox.action, "delete"), eq(eventOutbox.status, "completed"), sql`${eventOutbox.payload}->'caldavSeriesDeletion' is not null`,
      sql`${eventOutbox.payload}->'caldavSeriesDeletion'->'context'->'mappings' @> ${JSON.stringify([{ externalEventID }])}::jsonb`,
    )).limit(1);
    if (completed) return;
  }
  await tx
    .insert(externalEventTombstones)
    .values({ externalCalendarLinkID: target.id, externalEventID })
    .onConflictDoUpdate({
      target: [
        externalEventTombstones.externalCalendarLinkID,
        externalEventTombstones.externalEventID,
      ],
      // Each observation gets a distinct CAS version, even within one ms.
      set: { id: sql`gen_random_uuid()`, observedAt: new Date() },
    });
  for (const row of candidates) {
    await tx
      .select()
      .from(events)
      .where(eq(events.id, row.eventID))
      .for("update");
    await tx
      .update(eventOutbox)
      .set({
        status: "conflict",
        errorCode: "provider-conflict",
        leaseToken: null,
        leaseUntil: null,
        remoteSnapshot: {
          externalEventId: externalEventID,
          etag: null,
          deleted: true,
          observedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(eventOutbox.id, row.id),
          sql`${eventOutbox.status} not in ('completed', 'not-needed', 'cancelled')`,
        ),
      );
  }
}
