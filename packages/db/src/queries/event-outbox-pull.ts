import { isDeepStrictEqual } from "node:util";
import { EventTimeModelSchema, type Event, type ProviderEventState } from "@musubi/types";
import { matchesEventProviderProjection, matchesGoogleOccurrenceProjection, matchesReminderEventProjection, matchesRsvpEventProjection, matchesGoogleReminderIntent } from "./event-outbox-projection";
import { and, eq, sql } from "drizzle-orm";
import { eventOutbox, events, externalCalendars } from "../schema";
import type { DbTransaction } from "./calendars";
import type { EventOutboxRow } from "./event-outbox";

type PullValues = Partial<Pick<Event, "timeModel" | "originalStart" | "isCanceled" | "seriesID">> & {
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  description: string | null;
  location: string | null;
  recurrence: string | null;
};

function matchesRsvpTime(row: EventOutboxRow, values: PullValues) {
  const nativeTime = EventTimeModelSchema.safeParse(row.payload.rsvp?.nativeTime);
  // Unknown canonical metadata cannot erase a known provider zone. Missing or
  // still-unknown native time cannot establish a safe echo at all.
  if (!nativeTime.success || !["zoned", "all-day"].includes(nativeTime.data.kind)) return false;
  return matchesRsvpEventProjection(row.provider, { ...row.payload.event, timeModel: nativeTime.data }, values, row.payload.rsvp?.instance);
}
function matchesProjection(row: EventOutboxRow, values: PullValues, providerState?: ProviderEventState) {
  if (row.payload.rsvp) return row.action === "update" && matchesRsvpTime(row, values) && isDeepStrictEqual(providerState, row.payload.rsvp.desiredState);
  if (row.payload.reminderEdit) return row.action === "update" && matchesReminderEventProjection(row.provider, row.payload.event, values) && matchesGoogleReminderIntent(row.payload.reminderEdit.reminders, providerState);
  if (row.payload.googleOccurrence) return values.seriesID === row.payload.googleOccurrence.master.id && matchesGoogleOccurrenceProjection(row.payload.event, values);
  return (
    row.action !== "delete" &&
    matchesEventProviderProjection(
      row.provider,
      row.payload.providerProjection ?? row.payload.event,
      values,
    )
  );
}

/** Event lock is held by caller. A pull may advance its cursor only after this
 * conflicting content is retained. Never overwrite a pending local intention. */
export async function retainPendingEventPull(
  tx: DbTransaction,
  eventID: string,
  calendarID: string,
  provider: string,
  externalEventID: string,
  values: PullValues | null,
  etag: string | null,
  icalUid: string | null,
  providerState?: ProviderEventState,
  onlyReplaceObservation = false,
) {
  const rows = await tx
    .select()
    .from(eventOutbox)
    .where(
      and(
        eq(eventOutbox.eventID, eventID),
        eq(eventOutbox.calendarID, calendarID),
        eq(eventOutbox.provider, provider),
        sql`${eventOutbox.status} not in ('completed', 'not-needed', 'cancelled')`,
      ),
    )
    .for("update");
  if (!rows.length || (onlyReplaceObservation && !rows.some(row => row.remoteSnapshot))) return false;
  // A scope's local exception already contains the desired time/cancellation.
  // Its accepted pre-write provider baseline is still not a concurrent edit.
  if (values && rows.every(row => row.payload.googleOccurrence && row.expectedEtag === etag && values.seriesID === row.payload.googleOccurrence.master.id && matchesGoogleOccurrenceProjection(row.payload.googleOccurrence.baseline, values)) && rows.every(row => !row.remoteSnapshot)) return true;
  // An unchanged RSVP baseline is not a concurrent edit while its worker is
  // preparing the conditional write. Never erase a previously retained conflict.
  if (values && rows.every(row => row.payload.rsvp && row.expectedEtag === etag && matchesRsvpTime(row, values) && isDeepStrictEqual(providerState, row.payload.rsvp.baselineState) && !row.remoteSnapshot)) return true;
  // Our in-flight echo is not permission to replace newer local content or ETag.
  const echo = rows.find(
    (row) =>
      row.attempts > 0 &&
      (values ? matchesProjection(row, values, providerState) : row.action === "delete"),
  );
  if (echo) {
    // Keep provider-owned metadata too, even when the projected content is our
    // own echo. Cursor advancement must not discard an unaccepted observation.
    if (!echo.remoteSnapshot || echo.remoteSnapshot.isEcho)
      await tx
        .update(eventOutbox)
        .set({
          remoteSnapshot: {
            ...(providerState ? { providerState } : {}),
            isEcho: true,
            externalEventId: externalEventID,
            etag,
            icalUid,
            deleted: !values,
            observedAt: new Date().toISOString(),
            ...(values ? { values: JSON.parse(JSON.stringify(values)) } : {}),
          },
        })
        .where(eq(eventOutbox.id, echo.id));
    return true;
  }
  await tx
    .update(eventOutbox)
    .set({
      remoteSnapshot: {
        ...(providerState ? { providerState } : {}),
        externalEventId: externalEventID,
        etag,
        icalUid,
        deleted: !values,
        observedAt: new Date().toISOString(),
        ...(values ? { values: JSON.parse(JSON.stringify(values)) } : {}),
      },
      status: "conflict",
      errorCode: "provider-conflict",
      leaseToken: null,
      leaseUntil: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(eventOutbox.eventID, eventID),
        eq(eventOutbox.calendarID, calendarID),
        eq(eventOutbox.provider, provider),
        sql`${eventOutbox.status} not in ('completed', 'not-needed', 'cancelled')`,
      ),
    );
  return true;
}

/** Match a create echo before its mapping ACK. Scoped to the original account
 * connection; a marker from another calendar cannot claim a local identity. */
export async function retainUnmappedCreatePull(
  tx: DbTransaction,
  provider: string,
  userID: string,
  calendarID: string,
  externalCalendarID: string,
  externalEventID: string,
  values: PullValues,
  etag: string | null,
  icalUid: string | null,
  operationID?: string,
  providerState?: ProviderEventState,
) {
  const candidate =
    provider === "caldav" && icalUid?.startsWith("musubi-")
      ? icalUid.slice(7)
      : operationID;
  if (
    !candidate ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      candidate,
    )
  )
    return false;
  const [row] = await tx
    .select()
    .from(eventOutbox)
    .where(
      and(
        eq(eventOutbox.id, candidate),
        eq(eventOutbox.action, "create"),
        eq(eventOutbox.provider, provider),
        eq(eventOutbox.userID, userID),
        eq(eventOutbox.calendarID, calendarID),
        eq(eventOutbox.externalCalendarID, externalCalendarID),
      ),
    );
  if (!row || row.payload.createIdentityVersion !== 1) return false;
  const [target] = await tx
    .select()
    .from(externalCalendars)
    .where(
      and(
        eq(externalCalendars.id, row.externalCalendarLinkID),
        eq(externalCalendars.calendarID, calendarID),
        eq(externalCalendars.accountID, row.accountID),
        eq(externalCalendars.userID, row.userID),
        eq(externalCalendars.disabled, false),
      ),
    );
  if (!target) return false;
  if (
    provider === "google" &&
    externalEventID !== `musubi${row.id.replace(/-/g, "")}`
  )
    return false;
  if (
    provider === "caldav" &&
    externalEventID !==
      `${externalCalendarID.replace(/\/?$/, "/")}musubi-${row.id}.ics`
  )
    return false;
  await tx
    .select()
    .from(events)
    .where(eq(events.id, row.eventID))
    .for("update");
  // Completed or removed local identities must not be resurrected by a late echo.
  const retained = await retainPendingEventPull(
    tx,
    row.eventID,
    calendarID,
    provider,
    externalEventID,
    values,
    etag,
    icalUid,
    providerState,
  );
  if (!retained)
    await tx
      .update(eventOutbox)
      .set({
        remoteSnapshot: {
          ...(providerState ? { providerState } : {}),
          isEcho: matchesProjection(row, values, providerState),
          externalEventId: externalEventID,
          etag,
          icalUid,
          deleted: false,
          values: JSON.parse(JSON.stringify(values)),
          observedAt: new Date().toISOString(),
        },
      })
      .where(eq(eventOutbox.id, row.id));
  return true;
}
