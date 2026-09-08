import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  calendarEvents,
  eventOutbox,
  events,
  externalCalendars,
  externalEvents,
} from "../schema";
import type { DbTransaction } from "./calendars";
import { appendEventOutbox, type EventOutboxIntent } from "./event-outbox";
import type { EventContentPatch } from "./events";

/** Called with the authoritative event lock held, in the inbound transaction.
 * Capture derived destinations only; network authorization happens in delivery. */
export async function appendInboundEventFanout(
  tx: DbTransaction,
  eventID: string,
  sourceCalendarID: string,
  action: "update" | "delete",
  patch: EventContentPatch = {},
) {
  const [current] = await tx
    .select()
    .from(events)
    .where(eq(events.id, eventID));
  if (!current || current.originCalendarID !== sourceCalendarID) return;
  const links = await tx
    .select({ id: calendarEvents.calendarID })
    .from(calendarEvents)
    .where(eq(calendarEvents.eventID, eventID));
  const event = { ...current, calendars: links.map((link) => link.id) };
  const intents: EventOutboxIntent[] = [];
  const mutationID = randomUUID();
  for (const link of links) {
    if (link.id === sourceCalendarID) continue;
    const [target] = await tx
      .select()
      .from(externalCalendars)
      .where(
        and(
          eq(externalCalendars.calendarID, link.id),
          eq(externalCalendars.disabled, false),
          eq(externalCalendars.supportsEvents, true),
        ),
      );
    if (!target) continue;
    const [mapping] = await tx
      .select()
      .from(externalEvents)
      .where(
        and(
          eq(externalEvents.eventID, eventID),
          eq(externalEvents.calendarID, link.id),
          eq(externalEvents.provider, target.provider),
        ),
      );
    const [previous] = await tx
      .select()
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.eventID, eventID),
          eq(eventOutbox.calendarID, link.id),
          eq(eventOutbox.externalCalendarLinkID, target.id),
        ),
      )
      .orderBy(desc(eventOutbox.revision), desc(eventOutbox.createdAt), desc(eventOutbox.position), desc(eventOutbox.id))
      .limit(1);
    if (action === "delete" && !mapping && !previous) continue;
    const deliveryAction =
      action === "delete"
        ? "delete"
        : previous?.action === "delete"
          ? "create"
          : mapping || previous
            ? "update"
            : "create";
    intents.push({
      id: randomUUID(),
      actorID: current.creatorID,
      mutationID,
      position: intents.length,
      eventID,
      calendarID: link.id,
      externalCalendarLinkID: target.id,
      userID: target.userID,
      provider: target.provider,
      accountID: target.accountID,
      externalCalendarID: target.externalCalendarID,
      externalEventID:
        deliveryAction === "create" ? null : (mapping?.externalEventID ?? null),
      expectedEtag:
        deliveryAction === "create" ? null : (mapping?.etag ?? null),
      icalUid: deliveryAction === "create" ? null : (mapping?.icalUid ?? null),
      action: deliveryAction,
      payload: { event, patch, createIdentityVersion: 1 },
    });
  }
  await appendEventOutbox(tx, event, intents);
}
