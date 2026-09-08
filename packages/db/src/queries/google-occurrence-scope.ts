import { and, eq, inArray, sql } from "drizzle-orm";
import {
  EventWriteError,
  type Event,
  type OccurrenceStart,
  type ProviderEventState,
} from "@musubi/types";
import { externalCalendars, externalEvents, eventOutbox } from "../schema";
import type { DbTransaction } from "./calendars";
import { appendEventOutbox } from "./event-outbox";

export type GoogleOccurrenceContext = {
  master: Event;
  children: Event[];
  link: typeof externalCalendars.$inferSelect & { calendarID: string };
  mapping: typeof externalEvents.$inferSelect;
};
export type GoogleOccurrencePrepared = {
  context: GoogleOccurrenceContext;
  externalEventID: string;
  etag: string;
  baseline: Event;
  providerState: ProviderEventState;
};
export type GoogleOccurrenceIntent = {
  master: Event;
  masterExternalID: string;
  masterEtag: string;
  originalStart: OccurrenceStart;
  baseline: Event;
};

export async function googleOccurrenceContext(
  tx: DbTransaction,
  actorID: string,
  master: Event,
  children: Event[],
): Promise<GoogleOccurrenceContext> {
  const unsupported = () =>
    new EventWriteError(
      "event-write",
      "unsupported",
      "This source requires another provider scope capability. No changes were saved.",
    );
  const family = [master, ...children];
  if (
    !master.originCalendarID ||
    family.some(
      (event) =>
        event.calendars.length !== 1 ||
        event.calendars[0] !== master.originCalendarID,
    )
  )
    throw unsupported();
  const [link] = await tx
    .select()
    .from(externalCalendars)
    .where(eq(externalCalendars.calendarID, master.originCalendarID))
    .for("share");
  if (
    !link ||
    link.provider !== "google" ||
    link.userID !== actorID ||
    link.disabled ||
    !link.supportsEvents
  )
    throw unsupported();
  const mappings = await tx
    .select()
    .from(externalEvents)
    .where(
      inArray(
        externalEvents.eventID,
        family.map((event) => event.id),
      ),
    )
    .for("update");
  const mapping = mappings.find((item) => item.eventID === master.id);
  if (
    !mapping?.etag ||
    mapping.provider !== "google" ||
    mapping.calendarID !== link.calendarID ||
    mapping.externalCalendarID !== link.externalCalendarID ||
    mapping.externalSeriesID ||
    mappings.some(
      (item) =>
        item.calendarID !== link.calendarID || item.provider !== "google",
    )
  )
    throw unsupported();
  const pending = await tx
    .select({ id: eventOutbox.id })
    .from(eventOutbox)
    .where(
      and(
        inArray(
          eventOutbox.eventID,
          family.map((event) => event.id),
        ),
        sql`${eventOutbox.status} not in ('completed', 'not-needed')`,
      ),
    )
    .limit(1);
  if (pending.length)
    throw new EventWriteError(
      "event-write",
      "unsupported",
      "Reconcile pending family delivery before another scope change. No changes were saved.",
    );
  return {
    master,
    children,
    link: { ...link, calendarID: master.originCalendarID },
    mapping,
  };
}

export async function appendGoogleOccurrence(
  tx: DbTransaction,
  actorID: string,
  operationID: string,
  context: GoogleOccurrenceContext,
  prepared: GoogleOccurrencePrepared,
  event: Event,
) {
  if (!event.originalStart || event.seriesID !== context.master.id)
    throw new Error("Invalid provider scope plan.");
  const occupied = await tx
    .select()
    .from(externalEvents)
    .where(
      and(
        eq(externalEvents.calendarID, context.link.calendarID),
        eq(externalEvents.externalEventID, prepared.externalEventID),
      ),
    )
    .for("update");
  if (occupied.some((map) => map.eventID !== event.id))
    throw new EventWriteError(
      "event-write",
      "unsupported",
      "Provider occurrence identity changed. Refresh before retrying.",
    );
  if (!occupied.length)
    await tx
      .insert(externalEvents)
      .values({
        provider: "google",
        eventID: event.id,
        calendarID: context.link.calendarID,
        externalCalendarID: context.link.externalCalendarID,
        externalEventID: prepared.externalEventID,
        etag: prepared.etag,
        externalSeriesID: context.mapping.externalEventID,
        originalStart: event.originalStart,
        providerState: prepared.providerState,
      });
  else if (
    occupied[0].etag !== prepared.etag ||
    occupied[0].externalSeriesID !== context.mapping.externalEventID ||
    JSON.stringify(occupied[0].originalStart) !==
      JSON.stringify(event.originalStart)
  )
    throw new EventWriteError(
      "event-write",
      "unsupported",
      "Provider occurrence version changed. Refresh before retrying.",
    );
  await appendEventOutbox(tx, event, [
    {
      id: crypto.randomUUID(),
      actorID,
      mutationID: operationID,
      position: 0,
      eventID: event.id,
      calendarID: context.link.calendarID,
      externalCalendarLinkID: context.link.id,
      provider: "google",
      userID: actorID,
      accountID: context.link.accountID,
      externalCalendarID: context.link.externalCalendarID,
      externalEventID: prepared.externalEventID,
      expectedEtag: prepared.etag,
      action: "update",
      payload: {
        event,
        googleOccurrence: {
          master: context.master,
          masterExternalID: context.mapping.externalEventID,
          masterEtag: context.mapping.etag!,
          originalStart: event.originalStart,
          baseline: prepared.baseline,
        },
      },
    },
  ]);
}
