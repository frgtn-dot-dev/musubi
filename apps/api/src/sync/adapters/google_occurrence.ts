import { config } from "@musubi/config";
import {
  matchesGoogleOccurrenceProjection,
  matchesEventProviderProjection,
  type GoogleOccurrenceIntent,
} from "@musubi/db";
import {
  EventTimeModelSchema,
  EventWriteError,
  OccurrenceStartSchema,
  type Event,
} from "@musubi/types";
import type { ExternalEventRef, NormalizedEvent } from "../adapter";
import { normalizeGoogleTime } from "./google_time";
import { googleEventState } from "./provider_event_state";
import { assertCompleteEventReadResponse } from "../event_create_identity";
import {
  assertAcceptedEventEtag,
  assertOAuthEventWriteGrant,
  assertProviderEventMutationResponse,
  ProviderEventWriteError,
  requireEventEtag,
} from "../event_write";

const GCAL = "https://www.googleapis.com/calendar/v3";
export type GoogleOccurrenceEvidence = {
  ref: ExternalEventRef;
  event: NormalizedEvent;
  state: ReturnType<typeof googleEventState>;
};
export function matchesGoogleOccurrence(
  expected: Event,
  actual: NormalizedEvent,
) {
  return (
    actual.status === "active" &&
    matchesGoogleOccurrenceProjection(expected, actual)
  );
}

export function googleOccurrenceMethods(
  tokenFor: (user: string, account: string) => Promise<string>,
  normalize: (raw: any) => NormalizedEvent,
) {
  const guard = () => {
    if (!config.api.eventTimeEditsEnabled)
      throw new EventWriteError("event-write", "unsupported");
  };
  const personal = (raw: any, parent = false) => {
    if (
      ((raw.status !== "cancelled" || parent) &&
        raw.organizer?.self !== true) ||
      raw.attendeesOmitted ||
      (raw.attendees != null &&
        (!Array.isArray(raw.attendees) || raw.attendees.length > 0)) ||
      (raw.eventType && raw.eventType !== "default")
    )
      throw new EventWriteError(
        "event-write",
        "unsupported",
        "Meeting scope writes require explicit notification support.",
      );
  };
  const path = (calendar: string, event: string) =>
    `${GCAL}/calendars/${encodeURIComponent(calendar)}/events/${encodeURIComponent(event)}`;
  const read = async (url: string, token: string, signal?: AbortSignal) => {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-cache",
      },
      redirect: "error",
      signal,
    });
    assertCompleteEventReadResponse(response);
    return response.json();
  };
  async function readOccurrence(
    user: string,
    account: string,
    calendar: string,
    intent: GoogleOccurrenceIntent,
    ref?: ExternalEventRef,
    signal?: AbortSignal,
  ): Promise<GoogleOccurrenceEvidence> {
    guard();
    const token = await tokenFor(user, account);
    await assertOAuthEventWriteGrant(user, "google", account);
    const grant = await read(
      `${GCAL}/users/me/calendarList/${encodeURIComponent(calendar)}`,
      token,
      signal,
    );
    if (!["owner", "writer"].includes(grant.accessRole))
      throw new EventWriteError("event-write", "denied");
    const master = await read(
      path(calendar, intent.masterExternalID),
      token,
      signal,
    );
    if (
      master.id !== intent.masterExternalID ||
      master.status === "cancelled" ||
      master.recurringEventId ||
      !master.recurrence?.length
    )
      throw new ProviderEventWriteError("provider-conflict");
    personal(master, true);
    assertAcceptedEventEtag(intent.masterEtag, master.etag);
    const masterEvent = normalizeGoogleTime(
      master,
      normalize({ ...master, recurrence: undefined }),
    );
    if (
      !matchesEventProviderProjection("google", intent.master, masterEvent) ||
      JSON.stringify(EventTimeModelSchema.parse(intent.master.timeModel)) !==
        JSON.stringify(masterEvent.timeModel)
    )
      throw new ProviderEventWriteError("provider-conflict");
    const evidence = (raw: any): GoogleOccurrenceEvidence => {
      if (
        !raw ||
        typeof raw.id !== "string" ||
        raw.recurringEventId !== intent.masterExternalID
      )
        throw new ProviderEventWriteError("provider-conflict");
      personal(raw);
      const event = normalizeGoogleTime(
        raw,
        normalize({ ...raw, recurrence: undefined }),
        master,
      );
      if (
        JSON.stringify(event.originalStart) !==
        JSON.stringify(OccurrenceStartSchema.parse(intent.originalStart))
      )
        throw new ProviderEventWriteError("provider-conflict");
      return {
        ref: { externalEventId: raw.id, etag: requireEventEtag(raw.etag) },
        event,
        state: googleEventState(raw),
      };
    };
    if (ref) {
      const raw = await read(
        path(calendar, ref.externalEventId),
        token,
        signal,
      );
      if (raw.id !== ref.externalEventId)
        throw new ProviderEventWriteError("provider-conflict");
      return evidence(raw);
    }
    const matches: GoogleOccurrenceEvidence[] = [];
    const seen = new Set<string>();
    let next = "";
    do {
      if (seen.has(next))
        throw new ProviderEventWriteError("provider-conflict");
      seen.add(next);
      const query = new URLSearchParams({
        originalStart: intent.originalStart.value,
        showDeleted: "true",
        maxResults: "2500",
        ...(next ? { pageToken: next } : {}),
      });
      const page = await read(
        `${path(calendar, intent.masterExternalID)}/instances?${query}`,
        token,
        signal,
      );
      if (!Array.isArray(page.items))
        throw new ProviderEventWriteError("provider-conflict");
      for (const item of page.items) matches.push(evidence(item));
      next = page.nextPageToken ?? "";
      if (typeof next !== "string" || seen.size > 100)
        throw new ProviderEventWriteError("provider-conflict");
    } while (next);
    if (matches.length !== 1)
      throw new ProviderEventWriteError("provider-conflict");
    return matches[0];
  }
  async function writeOccurrence(
    user: string,
    account: string,
    calendar: string,
    intent: GoogleOccurrenceIntent,
    event: Event,
    ref: ExternalEventRef,
    signal?: AbortSignal,
  ): Promise<GoogleOccurrenceEvidence> {
    guard();
    const before = await readOccurrence(
      user,
      account,
      calendar,
      intent,
      ref,
      signal,
    );
    assertAcceptedEventEtag(ref.etag, before.ref.etag);
    if (!matchesGoogleOccurrence(intent.baseline, before.event))
      throw new ProviderEventWriteError("provider-conflict");
    let body: Record<string, unknown> = { status: "cancelled" };
    if (!event.isCanceled) {
      const model = EventTimeModelSchema.parse(event.timeModel);
      if (!["zoned", "all-day"].includes(model.kind))
        throw new EventWriteError("event-write", "unsupported");
      body = {
        ...(before.event.isCanceled ? { status: "confirmed" } : {}),
        summary: event.title,
        description: event.description ?? null,
        location: event.location ?? null,
        start:
          model.kind === "all-day"
            ? { date: event.start.toISOString().slice(0, 10) }
            : {
                dateTime: event.start.toISOString(),
                timeZone: model.kind === "zoned" ? model.timeZone : undefined,
              },
        end:
          model.kind === "all-day"
            ? {
                date: new Date(event.end.getTime() + 86400000)
                  .toISOString()
                  .slice(0, 10),
              }
            : {
                dateTime: event.end.toISOString(),
                timeZone: model.kind === "zoned" ? model.timeZone : undefined,
              },
      };
    }
    const response = await fetch(
      `${path(calendar, ref.externalEventId)}?sendUpdates=none`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${await tokenFor(user, account)}`,
          "Content-Type": "application/json",
          "If-Match": requireEventEtag(ref.etag),
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal,
      },
    );
    assertProviderEventMutationResponse(response);
    // Confirm through the same identity/temporal evidence boundary. Malformed or
    // unavailable post-write evidence is always an ambiguous remote outcome.
    try {
      const result = await readOccurrence(
        user,
        account,
        calendar,
        intent,
        ref,
        signal,
      );
      if (!matchesGoogleOccurrence(event, result.event))
        throw new Error("Unconfirmed occurrence write");
      return result;
    } catch {
      throw new ProviderEventWriteError("provider-write-failed", "unconfirmed");
    }
  }
  return { readOccurrence, writeOccurrence };
}
