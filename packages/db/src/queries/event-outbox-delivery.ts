import { ProviderEventStateSchema } from "@musubi/types";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "..";
import {
  calendarEvents,
  eventOutbox,
  events,
  externalCalendars,
  externalEvents,
  externalEventTombstones,
} from "../schema";
import { lockCalendarLifecycle } from "./calendar-lifecycle";
import type { EventOutboxRow } from "./event-outbox";
import type { DbTransaction } from "./calendars";
import { lockExternalEventIdentity } from "./event-outbox-deletions";

export type EventDeliveryRef = NonNullable<EventOutboxRow["resultRef"]>;
class DeliveryLeaseExpired extends Error {}

export async function getEventOutboxRow(id: string) {
  const [row] = await db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.id, id));
  return row;
}

/** Only our completed predecessor may advance the captured target version. */
export async function getEventOutboxExpectedRef(
  row: EventOutboxRow,
): Promise<EventDeliveryRef | null> {
  const predecessor = row.predecessorID
    ? await getEventOutboxRow(row.predecessorID)
    : undefined;
  if (
    predecessor?.resultRef &&
    ["completed", "not-needed"].includes(predecessor.status) &&
    predecessor.externalCalendarLinkID === row.externalCalendarLinkID &&
    predecessor.eventID === row.eventID &&
    predecessor.calendarID === row.calendarID &&
    (!row.externalEventID ||
      row.expectedEtag === predecessor.expectedEtag ||
      row.expectedEtag === predecessor.resultRef.etag) &&
    (!row.externalEventID ||
      row.externalEventID === predecessor.resultRef.externalEventId)
  )
    return predecessor.resultRef;
  return row.externalEventID
    ? {
        externalEventId: row.externalEventID,
        etag: row.expectedEtag,
        icalUid: row.icalUid,
      }
    : null;
}

async function settle(
  tx: DbTransaction,
  row: EventOutboxRow,
  status: EventOutboxRow["status"],
  errorCode: string | null,
  resultRef: EventDeliveryRef | null,
) {
  const [saved] = await tx
    .update(eventOutbox)
    .set({
      status,
      errorCode,
      resultRef,
      remoteSnapshot: row.remoteSnapshot,
      leaseToken: null,
      leaseUntil: null,
      uncertain: status === "unconfirmed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(eventOutbox.id, row.id),
        eq(eventOutbox.leaseToken, row.leaseToken!),
        sql`${eventOutbox.leaseUntil} > clock_timestamp()`,
      ),
    )
    .returning();
  if (!saved) throw new DeliveryLeaseExpired(); // Roll back mapping changes too.
  return saved;
}

/** Later local revisions require the same target's persisted successor chain. */
async function coversCurrentRevision(
  tx: DbTransaction,
  row: EventOutboxRow,
  revision: number | undefined,
) {
  let [latest] = await tx
    .select()
    .from(eventOutbox)
    .where(
      and(
        eq(eventOutbox.eventID, row.eventID),
        eq(eventOutbox.calendarID, row.calendarID),
        eq(eventOutbox.externalCalendarLinkID, row.externalCalendarLinkID),
      ),
    )
    .orderBy(desc(eventOutbox.revision), desc(eventOutbox.createdAt), desc(eventOutbox.position), desc(eventOutbox.id))
    .limit(1);
  if (
    !latest ||
    (revision === undefined
      ? latest.action !== "delete"
      : latest.revision !== revision)
  )
    return false;
  const seen = new Set<string>();
  while (latest.id !== row.id) {
    if (
      seen.has(latest.id) ||
      seen.size >= 1000 ||
      !latest.predecessorID ||
      ["conflict", "blocked", "cancelled"].includes(latest.status)
    )
      return false;
    seen.add(latest.id);
    const [previous] = await tx
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.id, latest.predecessorID));
    if (
      !previous ||
      previous.eventID !== row.eventID ||
      previous.calendarID !== row.calendarID ||
      previous.externalCalendarLinkID !== row.externalCalendarLinkID
    )
      return false;
    latest = previous;
  }
  return true;
}

export async function hasEventOutboxRevisionCoverage(row: EventOutboxRow) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(events)
      .where(eq(events.id, row.eventID))
      .for("update");
    return (
      current?.revision === row.revision ||
      coversCurrentRevision(tx, row, current?.revision)
    );
  });
}

/** Acknowledgement and mapping acceptance are one transaction. Preserve lock
 * order lifecycle -> event -> mapping/outbox, and fence completion by live lease. */
export async function completeEventOutbox(
  id: string,
  leaseToken: string,
  resultRef: EventDeliveryRef | null,
  expectedRef: EventDeliveryRef | null,
  observation?: EventOutboxRow["remoteSnapshot"],
) {
  try {
    return await db.transaction(async (tx) => {
      const [address] = await tx
        .select()
        .from(eventOutbox)
        .where(eq(eventOutbox.id, id));
      if (!address || address.payload.caldavSeries || address.payload.rsvp) return undefined;
      await lockCalendarLifecycle(tx, [address.calendarID], "shared");
      const resource =
        resultRef ?? (address.action === "delete" ? expectedRef : null);
      if (resource)
        await lockExternalEventIdentity(
          tx,
          address.externalCalendarLinkID,
          resource.externalEventId,
        );
      if (address.payload.googleOccurrence)
        await tx.select({ id: events.id }).from(events).where(eq(events.id, address.payload.googleOccurrence.master.id)).for("update");
      const [current] = await tx
        .select()
        .from(events)
        .where(eq(events.id, address.eventID))
        .for("update");
      const [row] = await tx
        .select()
        .from(eventOutbox)
        .where(
          and(
            eq(eventOutbox.id, id),
            eq(eventOutbox.leaseToken, leaseToken),
            eq(eventOutbox.status, "attempting"),
            sql`${eventOutbox.leaseUntil} > clock_timestamp()`,
          ),
        )
        .for("update");
      if (!row) return undefined;
      const [target] = await tx
        .select()
        .from(externalCalendars)
        .where(
          and(
            eq(externalCalendars.id, row.externalCalendarLinkID),
            eq(externalCalendars.calendarID, row.calendarID),
            eq(externalCalendars.userID, row.userID),
            eq(externalCalendars.provider, row.provider),
            eq(externalCalendars.accountID, row.accountID),
            eq(externalCalendars.externalCalendarID, row.externalCalendarID),
            eq(externalCalendars.disabled, false),
            eq(externalCalendars.supportsEvents, true),
          ),
        );
      if (!target)
        return settle(
          tx,
          row,
          "cancelled",
          "destination-disconnected",
          resultRef,
        );
      if (row.payload.googleOccurrence) {
        const [master] = await tx.select({ revision: events.revision, deletedAt: events.deletedAt }).from(events).where(eq(events.id, row.payload.googleOccurrence.master.id));
        if (!master || master.deletedAt || master.revision !== row.payload.googleOccurrence.master.revision)
          return settle(tx, row, "unconfirmed", "local-master-revision-changed", resultRef);
      }
      if (observation?.isEcho && observation.externalEventId === resultRef?.externalEventId &&
          (!row.remoteSnapshot || row.remoteSnapshot.isEcho && observation.observedAt >= row.remoteSnapshot.observedAt))
        row.remoteSnapshot = observation;
      if (row.remoteSnapshot && !row.remoteSnapshot.isEcho)
        return settle(tx, row, "conflict", "provider-conflict", resultRef);
      if (row.action !== "delete" && resultRef) {
        const [deleted] = await tx
          .select()
          .from(externalEventTombstones)
          .where(
            and(
              eq(
                externalEventTombstones.externalCalendarLinkID,
                row.externalCalendarLinkID,
              ),
              eq(
                externalEventTombstones.externalEventID,
                resultRef.externalEventId,
              ),
            ),
          );
        if (deleted) {
          row.remoteSnapshot = {
            externalEventId: resultRef.externalEventId,
            etag: null,
            deleted: true,
            observedAt: deleted.observedAt.toISOString(),
          };
          return settle(tx, row, "conflict", "provider-conflict", resultRef);
        }
      }
      if (
        row.action !== "delete" &&
        current?.revision !== row.revision &&
        !(await coversCurrentRevision(tx, row, current?.revision))
      )
        return settle(
          tx,
          row,
          "unconfirmed",
          "local-revision-changed",
          resultRef,
        );
      const [linked] = await tx
        .select({ id: calendarEvents.eventID })
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.eventID, row.eventID),
            eq(calendarEvents.calendarID, row.calendarID),
          ),
        );
      if (
        row.action !== "delete" &&
        resultRef &&
        current &&
        !current.deletedAt &&
        linked
      ) {
        const mappings = await tx
          .select()
          .from(externalEvents)
          .where(
            and(
              eq(externalEvents.provider, row.provider),
              eq(externalEvents.calendarID, row.calendarID),
              eq(externalEvents.eventID, row.eventID),
            ),
          )
          .for("update");
        const [occupied] = await tx
          .select()
          .from(externalEvents)
          .where(
            and(
              eq(externalEvents.provider, row.provider),
              eq(externalEvents.calendarID, row.calendarID),
              eq(externalEvents.externalEventID, resultRef.externalEventId),
            ),
          );
        if (
          (occupied && occupied.eventID !== row.eventID) ||
          mappings.length > 1
        )
          return settle(
            tx,
            row,
            "conflict",
            "mapping-identity-changed",
            resultRef,
          );
        const mapping = mappings[0];
        if (
          mapping &&
          (mapping.externalEventID !== resultRef.externalEventId ||
            (row.action === "update" &&
              (mapping.externalEventID !== expectedRef?.externalEventId ||
                mapping.etag !== (expectedRef?.etag ?? null))))
        )
          return settle(
            tx,
            row,
            "conflict",
            "mapping-version-changed",
            resultRef,
          );
        // This is the last observed personal state, not a projection of our
        // content write. Its observation may precede or follow the ACK version.
        const observedState = row.remoteSnapshot?.isEcho &&
          row.remoteSnapshot.externalEventId === resultRef.externalEventId &&
          !row.remoteSnapshot.deleted && row.remoteSnapshot.providerState
          ? ProviderEventStateSchema.parse(row.remoteSnapshot.providerState) : undefined;
        if (observedState && observedState.provider !== row.provider)
          throw new Error("Provider observation destination mismatch.");
        const observedAt = row.remoteSnapshot ? new Date(row.remoteSnapshot.observedAt) : null;
        const acceptState = observedState && observedAt && Number.isFinite(observedAt.getTime()) &&
          (!mapping?.providerStateObservedAt || observedAt > mapping.providerStateObservedAt);
        const metadata = {
          ...(acceptState ? { providerState: observedState, providerStateObservedAt: observedAt } : {}),
          etag: resultRef.etag ?? null,
          icalUid: resultRef.icalUid ?? mapping?.icalUid ?? null,
        };
        if (mapping)
          await tx
            .update(externalEvents)
            .set(metadata)
            .where(eq(externalEvents.id, mapping.id));
        else if (row.action === "create")
          await tx.insert(externalEvents).values({
            provider: row.provider,
            eventID: row.eventID,
            calendarID: row.calendarID,
            externalCalendarID: row.externalCalendarID,
            externalEventID: resultRef.externalEventId,
            ...metadata,
          });
        else
          return settle(
            tx,
            row,
            "conflict",
            "mapping-identity-changed",
            resultRef,
          );
      }
      if (row.action === "delete" && expectedRef) {
        const [mapping] = await tx
          .select()
          .from(externalEvents)
          .where(
            and(
              eq(externalEvents.provider, row.provider),
              eq(externalEvents.calendarID, row.calendarID),
              eq(externalEvents.eventID, row.eventID),
            ),
          )
          .for("update");
        if (mapping) {
          if (
            mapping.externalEventID !== expectedRef.externalEventId ||
            mapping.etag !== (expectedRef.etag ?? null)
          )
            return settle(
              tx,
              row,
              "conflict",
              "mapping-version-changed",
              resultRef,
            );
          await tx
            .delete(externalEvents)
            .where(eq(externalEvents.id, mapping.id));
        }
      }
      return settle(
        tx,
        row,
        resultRef || row.action === "delete" ? "completed" : "not-needed",
        null,
        resultRef,
      );
    });
  } catch (error) {
    if (error instanceof DeliveryLeaseExpired) return undefined;
    throw new Error("Event delivery acknowledgement could not be persisted.");
  }
}
