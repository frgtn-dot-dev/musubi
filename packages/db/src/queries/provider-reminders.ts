import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  BadRequestError,
  EventSchema,
  EventWriteError,
  ForbiddenError,
  ProviderEventStateSchema,
  ProviderReminderEditSchema,
} from "@musubi/types";
import { db } from "..";
import {
  calendarEvents,
  calendarMembers,
  events,
  eventOutbox,
  externalCalendars,
  externalEvents,
} from "../schema";
import { lockCalendarLifecycle } from "./calendar-lifecycle";
import { appendEventOutbox } from "./event-outbox";

export function providerStateVersion(
  mapping: Pick<
    typeof externalEvents.$inferSelect,
    "id" | "etag" | "providerState"
  >,
) {
  return mapping.providerState
    ? createHash("sha256")
        .update(
          JSON.stringify({
            id: mapping.id,
            etag: mapping.etag,
            state: ProviderEventStateSchema.parse(mapping.providerState),
          }),
        )
        .digest("hex")
    : null;
}

/** Queue one personal provider change. No event content/revision, social action,
 * local notification or other destination changes as a side effect. */
export async function queueProviderReminderEdit(
  actorID: string,
  eventID: string,
  input: unknown,
) {
  const request = ProviderReminderEditSchema.parse(input);
  eventID = eventID.toLowerCase();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["musubi:event-mutation", actorID, request.operationID])}, 0))`,
    );
    const [initial] = await tx
      .select({ calendarID: events.originCalendarID })
      .from(events)
      .where(eq(events.id, eventID));
    if (!initial?.calendarID)
      throw new ForbiddenError("A live connected source event is required.");
    await lockCalendarLifecycle(tx, [initial.calendarID], "shared");
    const [event] = await tx
      .select()
      .from(events)
      .where(and(eq(events.id, eventID), isNull(events.deletedAt)))
      .for("update");
    if (!event || event.originCalendarID !== initial.calendarID)
      throw new ForbiddenError("The event source changed.");
    const [target] = await tx
      .select({ link: externalCalendars, role: calendarMembers.role })
      .from(externalCalendars)
      .innerJoin(
        calendarMembers,
        and(
          eq(calendarMembers.calendarID, externalCalendars.calendarID),
          eq(calendarMembers.userID, actorID),
        ),
      )
      .innerJoin(
        calendarEvents,
        and(
          eq(calendarEvents.calendarID, externalCalendars.calendarID),
          eq(calendarEvents.eventID, eventID),
        ),
      )
      .where(
        and(
          eq(externalCalendars.calendarID, initial.calendarID),
          eq(externalCalendars.userID, actorID),
          eq(externalCalendars.provider, request.provider),
          eq(externalCalendars.disabled, false),
          eq(externalCalendars.supportsEvents, true),
        ),
      )
      .for("share", { of: [calendarMembers, externalCalendars] });
    if (!target || !["owner", "editor"].includes(target.role))
      throw new ForbiddenError(
        "The connected source account must have write access.",
      );
    const [previous] = await tx
      .select()
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.actorID, actorID),
          eq(eventOutbox.mutationID, request.operationID),
        ),
      )
      .for("update");
    if (previous) {
      if (
        previous.externalCalendarLinkID !== target.link.id ||
        previous.accountID !== target.link.accountID
      )
        throw new ForbiddenError(
          "The connected source changed since this operation.",
        );
      if (
        previous.eventID !== eventID ||
        JSON.stringify(
          previous.payload.reminderEdit &&
            ProviderReminderEditSchema.parse(previous.payload.reminderEdit),
        ) !== JSON.stringify(request)
      )
        throw new BadRequestError(
          "This operation ID was already used for another request.",
        );
      return {
        operationID: previous.id,
        replayed: true,
        status: previous.status,
      };
    }
    const [mapping] = await tx
      .select()
      .from(externalEvents)
      .where(
        and(
          eq(externalEvents.eventID, eventID),
          eq(externalEvents.calendarID, initial.calendarID),
          eq(externalEvents.provider, request.provider),
          eq(externalEvents.externalCalendarID, target.link.externalCalendarID),
        ),
      )
      .for("update");
    if (
      !mapping?.etag ||
      mapping.etag.startsWith("W/") ||
      !mapping.providerState
    )
      throw new EventWriteError("event-write", "unsupported");
    if (
      event.revision !== request.expectedRevision ||
      providerStateVersion(mapping) !== request.expectedStateVersion
    )
      throw new BadRequestError(
        "Provider settings changed. Refresh before retrying.",
      );
    const pending = await tx
      .select({ id: eventOutbox.id })
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.eventID, eventID),
          eq(eventOutbox.calendarID, initial.calendarID),
          sql`${eventOutbox.status} not in ('completed', 'not-needed', 'cancelled')`,
        ),
      )
      .limit(1);
    if (pending.length)
      throw new BadRequestError(
        "This source has a pending operation. Reconcile it before changing provider reminders.",
      );
    const [latest] = await tx
      .select({ status: eventOutbox.status })
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.eventID, eventID),
          eq(eventOutbox.calendarID, initial.calendarID),
          eq(eventOutbox.externalCalendarLinkID, target.link.id),
        ),
      )
      .orderBy(
        desc(eventOutbox.revision),
        desc(eventOutbox.createdAt),
        desc(eventOutbox.position),
      )
      .limit(1);
    if (latest?.status === "cancelled")
      throw new BadRequestError(
        "The previous source operation was cancelled. Reconcile delivery before changing provider reminders.",
      );
    const links = await tx
      .select({ calendarID: calendarEvents.calendarID })
      .from(calendarEvents)
      .where(eq(calendarEvents.eventID, eventID));
    const snapshot = EventSchema.parse({
      ...event,
      calendars: links.map((link) => link.calendarID),
    });
    const id = randomUUID();
    await appendEventOutbox(tx, snapshot, [
      {
        id,
        actorID,
        mutationID: request.operationID,
        position: 0,
        eventID,
        calendarID: initial.calendarID,
        externalCalendarLinkID: target.link.id,
        provider: request.provider,
        userID: actorID,
        accountID: target.link.accountID,
        externalCalendarID: target.link.externalCalendarID,
        externalEventID: mapping.externalEventID,
        expectedEtag: mapping.etag,
        icalUid: mapping.icalUid,
        action: "update",
        payload: { event: snapshot, reminderEdit: request },
      },
    ]);
    return { operationID: id, replayed: false, status: "pending" as const };
  });
}
