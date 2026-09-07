import { and, desc, eq, sql } from "drizzle-orm";
import type { Event } from "@musubi/types";
import { db } from "..";
import { eventOutbox } from "../schema";
import type { DbTransaction } from "./calendars";

export type EventOutboxIntent = Pick<
  typeof eventOutbox.$inferInsert,
  | "id"
  | "actorID"
  | "mutationID"
  | "position"
  | "eventID"
  | "calendarID"
  | "externalCalendarLinkID"
  | "provider"
  | "userID"
  | "accountID"
  | "externalCalendarID"
  | "externalEventID"
  | "expectedEtag"
  | "icalUid"
  | "action"
  | "payload"
>;

/** The entire caller transaction must abort on duplicate identity. In particular,
 * a retried fork must not commit a second event with no corresponding operation. */
export class DuplicateEventMutationError extends Error {
  constructor() {
    super(
      "This mutation identity has already been committed. Reconcile before retrying.",
    );
    this.name = "DuplicateEventMutationError";
  }
}

/** Serializes explicitly keyed attempts before event locks, including creates
 * whose primary key would otherwise hide a duplicate behind a generic DB error. */
export async function reserveEventMutation(
  tx: DbTransaction,
  eventID: string,
  intents: readonly EventOutboxIntent[],
) {
  const selected = intents.filter((intent) => intent.eventID === eventID);
  if (!selected.length) return;
  const first = selected[0];
  if (
    selected.some(
      (intent) =>
        intent.actorID !== first.actorID ||
        intent.mutationID !== first.mutationID,
    )
  )
    throw new Error("An event mutation must have one actor and identity.");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
    ${JSON.stringify(["musubi:event-mutation", first.actorID, first.mutationID])}, 0))`);
  for (const intent of selected) {
    const [existing] = await tx
      .select({ id: eventOutbox.id })
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.actorID, intent.actorID),
          eq(eventOutbox.mutationID, intent.mutationID),
          eq(eventOutbox.position, intent.position),
        ),
      )
      .limit(1);
    if (existing) throw new DuplicateEventMutationError();
  }
}

/** Must be called inside the event's local transaction, after its CAS and before
 * COMMIT. No FK to events/maps: delete delivery must survive their removal. */
export async function appendEventOutbox(
  tx: DbTransaction,
  event: Event,
  intents: readonly EventOutboxIntent[],
) {
  for (const intent of intents.filter((item) => item.eventID === event.id)) {
    const [predecessor] = await tx
      .select({ id: eventOutbox.id })
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.eventID, event.id),
          eq(eventOutbox.calendarID, intent.calendarID),
        ),
      )
      .orderBy(
        desc(eventOutbox.revision),
        desc(eventOutbox.createdAt),
        desc(eventOutbox.position),
      )
      .limit(1);
    let inserted: { id: string } | undefined;
    try {
      [inserted] = await tx
        .insert(eventOutbox)
        .values({
          ...intent,
          revision: event.revision!,
          predecessorID: predecessor?.id ?? null,
          payload: { ...intent.payload, event },
        })
        .onConflictDoNothing()
        .returning({ id: eventOutbox.id });
    } catch {
      // Drizzle errors include bound JSON payloads. Never let those reach logs.
      throw new Error(
        "Event outbox persistence failed; local mutation was rolled back.",
      );
    }
    if (!inserted) throw new DuplicateEventMutationError();
  }
}

/** K07 only makes the request's first attempt durable. A crash after this claim
 * is an ambiguous attempt, NEVER automatically claimed again. K08 owns recovery. */
export async function claimEventOutbox(id: string) {
  const [row] = await db
    .update(eventOutbox)
    .set({
      status: "attempting",
      attempts: sql`${eventOutbox.attempts} + 1`,
      attemptedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(eventOutbox.id, id),
        eq(eventOutbox.status, "pending"),
        sql`(
    ${eventOutbox.predecessorID} is null or exists (
      select 1 from event_outbox predecessor where predecessor.id = ${eventOutbox.predecessorID}
      and predecessor.status in ('completed', 'not-needed')
    ))`,
      ),
    )
    .returning();
  return row;
}

export async function finishEventOutbox(
  id: string,
  status:
    "completed" | "not-needed" | "conflict" | "not-written" | "unconfirmed",
  errorCode: string | null = null,
) {
  await db
    .update(eventOutbox)
    .set({ status, errorCode, updatedAt: new Date() })
    .where(and(eq(eventOutbox.id, id), eq(eventOutbox.status, "attempting")));
}
