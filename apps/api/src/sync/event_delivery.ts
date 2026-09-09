import { confirmGraphSeriesCreateOutbox, completeGraphSeriesCreateOutbox, type GraphFamilyObservation } from "@musubi/db";
import { googleRsvpEventEvidence } from "./adapters/google_rsvp_projection";
import { googleRsvpEvidence } from "./adapters/google_rsvp";
import { googleEventState } from "./adapters/provider_event_state";
import { isDeepStrictEqual } from "node:util";
import { matchesGoogleOccurrence } from "./adapters/google_occurrence";
import { config } from "@musubi/config";
import { ProviderRsvpEditSchema, providerRsvpDesiredState, ProviderReminderEditSchema, type GoogleReminderWrite, type ProviderEventState, hasKnownEventTime, EventSchema, EventWriteError, type Event } from "@musubi/types";
import {
  confirmCaldavSplitOutbox,
  confirmCaldavSeriesOutbox,
  confirmCaldavSeriesDeletionOutbox,
  matchesRsvpEventProjection,
  hasProviderRsvpSource,
  completeProviderRsvpOutbox,
  matchesReminderEventProjection,
  matchesGoogleReminderIntent,
  matchesEventProviderProjection,
  claimEventOutbox,
  completeEventOutbox,
  finishEventOutbox,
  getEventOutboxExpectedRef,
  getEventOutboxRow,
  getExternalLinkForCalendar,
  hasEventOutboxRevisionCoverage,
  renewEventOutboxLease,
  setEventOutboxProjection,
  getEventOutboxDeletion,
  type EventOutboxRow,
  type EventContentPatch,
} from "@musubi/db";
import type {
  CalendarAdapter,
  CreatedEventEvidence,
  ExternalEventRef,
  NormalizedEvent,
} from "./adapter";
import { ProviderAuthError } from "./errors";
import {
  caldavEventCreateIdentity,
  googleEventCreateID,
} from "./event_create_identity";
import { ProviderEventWriteError, strongEventEtag } from "./event_write";

export function matchesReminderIntent(intent: GoogleReminderWrite, state: ProviderEventState) {
  return matchesGoogleReminderIntent(intent, state);
}

export function matchesReminderEvent(provider: string, expected: Event, actual: NormalizedEvent) {
  return actual.status === "active" && matchesReminderEventProjection(provider, expected, actual);
}

/** Only fields actually projected by EVENT serializers. Provider-owned URLs,
 * organizer and local appearance are not evidence of our write. */
export function matchesDeliveredEvent(
  provider: string,
  expected: Event,
  actual: NormalizedEvent,
) {
  return (
    actual.status === "active" &&
    matchesEventProviderProjection(provider, expected, actual)
  );
}

function snapshot(
  ref: ExternalEventRef,
  evidence: CreatedEventEvidence | null,
): EventOutboxRow["remoteSnapshot"] {
  return {
    externalEventId: ref.externalEventId,
    etag: evidence?.ref.etag ?? null,
    icalUid: evidence?.ref.icalUid ?? ref.icalUid,
    deleted: !evidence,
    observedAt: new Date().toISOString(),
    ...(evidence ? { values: JSON.parse(JSON.stringify(evidence.event)) } : {}),
  };
}

function revivePatch(
  patch: Record<string, unknown> | undefined,
): EventContentPatch | undefined {
  if (!patch) return undefined;
  return {
    ...patch,
    ...(patch.start === undefined
      ? {}
      : { start: new Date(patch.start as string) }),
    ...(patch.end === undefined ? {} : { end: new Date(patch.end as string) }),
  };
}

/** Shared request/background executor. Provider calls never run inside a DB
 * transaction. A timed-out or crashed attempt must reconcile before retrying. */
export async function deliverEventOutbox(
  id: string,
  adapterFor: (provider: string) => CalendarAdapter | null,
  options: { timeoutMs?: number } = {},
): Promise<EventOutboxRow | undefined> {
  const row = await claimEventOutbox(id);
  if (!row) return getEventOutboxRow(id);
  const token = row.leaseToken!;
  const adapter = adapterFor(row.provider);
  const controller = new AbortController();
  const signal = controller.signal;
  let mutationStarted = false;
  let remoteSnapshot: EventOutboxRow["remoteSnapshot"] = null;
  let expectedRef: ExternalEventRef | null = null;
  let resultRef: ExternalEventRef | null = null;
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy || signal.aborted) return;
    heartbeatBusy = true;
    void renewEventOutboxLease(row.id, token)
      .then(
        (ok) => {
          if (!ok) controller.abort();
        },
        () => controller.abort(),
      )
      .finally(() => {
        heartbeatBusy = false;
      });
  }, 20_000);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = async () => {
      const event = EventSchema.parse(row.payload.event);
      const checkDestination = async () => {
        signal.throwIfAborted();
        const link = await getExternalLinkForCalendar(row.calendarID);
        if (
          !link ||
          link.id !== row.externalCalendarLinkID ||
          link.userID !== row.userID ||
          link.accountID !== row.accountID ||
          link.provider !== row.provider ||
          link.externalCalendarID !== row.externalCalendarID ||
          link.disabled ||
          !link.supportsEvents
        ) {
          await finishEventOutbox(
            row.id,
            token,
            "cancelled",
            "destination-disconnected",
            { uncertain: row.reconciling || mutationStarted },
          );
          return false;
        }
        return true;
      };
      // Private instance reminder journals require their own worker and ACK.
      if (row.payload.reminderInstance) throw new EventWriteError("event-write", "unsupported");
      if (row.payload.graphSeriesCreate) {
        if (!config.api.eventTimeEditsEnabled || row.provider !== "microsoft" || row.action !== "create" || !adapter?.createGraphFamily)
          throw new EventWriteError("event-write", "unsupported");
        const check = async () => {
          if (!(await checkDestination()) || !(await confirmGraphSeriesCreateOutbox(row.id, token))) throw new ProviderEventWriteError("provider-conflict");
        };
        await check();
        let family;
        try {
          family = await adapter.createGraphFamily(row.userID, row.accountID, row.externalCalendarID, EventSchema.parse(row.payload.graphSeriesCreate.nativeEvent), { operationID: row.id, signal }, { uncertain: row.reconciling, beforeWrite: async () => { await check(); mutationStarted = true; } });
        } catch (error) {
          // A recovered native create can fail its subsequent complete read
          // even when this attempt sent no POST. Preserve that uncertainty.
          if (error instanceof ProviderEventWriteError && error.outcome === "unconfirmed") mutationStarted = true;
          throw error;
        }
        mutationStarted = true;
        signal.throwIfAborted();
        const project = (value: NormalizedEvent): GraphFamilyObservation["master"] => {
          if (!value.timeModel || !value.icalUid || !value.providerState) throw new ProviderEventWriteError("provider-write-failed", "unconfirmed");
          return { creationOperationID: value.creationOperationID, externalID: value.externalId, icalUid: value.icalUid, etag: value.etag ?? null, providerState: value.providerState,
            values: { title: value.title, description: value.description, location: value.location, organizer: value.organizer ?? "", url: value.url, start: value.start, end: value.end, isAllDay: value.isAllDay, recurrence: value.recurrence, timeModel: value.timeModel } };
        };
        const observation: GraphFamilyObservation = { master: project(family.master), instances: family.instances.map(value => {
          if (!value.originalStart) throw new ProviderEventWriteError("provider-write-failed", "unconfirmed");
          return { ...project(value), originalStart: value.originalStart };
        }), cancelled: family.cancelled };
        // Do not persist a master-only resultRef on failed acknowledgement.
        // Retry must recover the stable transaction and read its whole family.
        if (!(await checkDestination())) return;
        if (!(await completeGraphSeriesCreateOutbox(row.id, token, observation))) throw new ProviderEventWriteError("provider-conflict", "unconfirmed");
        return;
      }
      if (row.payload.caldavSplit) {
        const journal = row.payload.caldavSplit;
        const source = row.id === journal.sourceOperationID;
        if (!config.api.eventTimeEditsEnabled || row.provider !== "caldav" || !adapter?.writeCaldavSplitSource || !adapter.createCaldavSeries) throw new EventWriteError("event-write", "unsupported");
        const check = async () => {
          if (!(await checkDestination()) || !(await confirmCaldavSplitOutbox(row.id, token))) throw new ProviderEventWriteError("provider-conflict");
        };
        await check();
        expectedRef = source ? journal.prepared.split.source.baseline.ref : journal.prepared.split.creation.ref;
        mutationStarted = true;
        const observed = source
          ? await adapter.writeCaldavSplitSource(row.userID, row.accountID, row.externalCalendarID, journal.prepared.split, signal, check)
          : await adapter.createCaldavSeries(row.userID, row.accountID, row.externalCalendarID, journal.prepared.split, signal, check);
        resultRef = observed.ref;
        signal.throwIfAborted();
        if (!(await checkDestination())) return;
        if (!(await confirmCaldavSplitOutbox(row.id, token, resultRef))) throw new ProviderEventWriteError("provider-conflict", "unconfirmed");
        return;
      }
      if (row.payload.caldavSeriesDeletion) {
        if (!config.api.eventTimeEditsEnabled || row.provider !== "caldav" || row.action !== "delete" || !adapter?.deleteCaldavSeries) throw new EventWriteError("event-write", "unsupported");
        const check = async () => {
          if (!(await checkDestination()) || !(await confirmCaldavSeriesDeletionOutbox(row.id, token))) throw new ProviderEventWriteError("provider-conflict");
        };
        await check();
        expectedRef = row.payload.caldavSeriesDeletion.deletion.baseline.ref;
        mutationStarted = true;
        resultRef = await adapter.deleteCaldavSeries(row.userID, row.accountID, row.externalCalendarID, row.payload.caldavSeriesDeletion.deletion, signal, check);
        signal.throwIfAborted();
        if (!(await checkDestination())) return;
        if (!(await confirmCaldavSeriesDeletionOutbox(row.id, token, resultRef))) throw new ProviderEventWriteError("provider-conflict", "unconfirmed");
        return;
      }
      if (row.payload.caldavSeries) {
        if (!config.api.eventTimeEditsEnabled || row.provider !== "caldav" || row.action !== "update" || !adapter?.writeCaldavSeries)
          throw new EventWriteError("event-write", "unsupported");
        if (!(await checkDestination())) return;
        if (!(await confirmCaldavSeriesOutbox(row.id, token))) throw new ProviderEventWriteError("provider-conflict");
        expectedRef = row.payload.caldavSeries.write.baseline.ref;
        mutationStarted = true; // The resource executor reconciles before every conditional PUT.
        const observed = await adapter.writeCaldavSeries(row.userID, row.accountID, row.externalCalendarID, row.payload.caldavSeries.write, signal, async () => {
          if (!(await checkDestination()) || !(await confirmCaldavSeriesOutbox(row.id, token))) throw new ProviderEventWriteError("provider-conflict");
        });
        resultRef = observed.ref;
        signal.throwIfAborted();
        if (!(await checkDestination())) return;
        if (!(await confirmCaldavSeriesOutbox(row.id, token, resultRef))) throw new ProviderEventWriteError("provider-conflict", "unconfirmed");
        return;
      }
      if (row.payload.googleOccurrence) {
        if (!config.api.eventTimeEditsEnabled || row.provider !== "google" || row.action !== "update" || !adapter?.readOccurrence || !adapter.writeOccurrence)
          throw new EventWriteError("event-write", "unsupported");
        if (!(await checkDestination())) return;
        if (!(await hasEventOutboxRevisionCoverage(row))) throw new ProviderEventWriteError("provider-conflict");
        const intent = { ...row.payload.googleOccurrence, master: EventSchema.parse(row.payload.googleOccurrence.master), baseline: EventSchema.parse(row.payload.googleOccurrence.baseline) };
        expectedRef = await getEventOutboxExpectedRef(row);
        if (!expectedRef) throw new ProviderEventWriteError("provider-version-unavailable");
        let observed = await adapter.readOccurrence(row.userID, row.accountID, row.externalCalendarID, intent, expectedRef, signal);
        remoteSnapshot = { externalEventId: observed.ref.externalEventId, etag: observed.ref.etag ?? null, deleted: false, values: JSON.parse(JSON.stringify(observed.event)), providerState: observed.state, observedAt: new Date().toISOString() };
        if (!matchesGoogleOccurrence(event, observed.event)) {
          if (observed.ref.etag !== expectedRef.etag || !matchesGoogleOccurrence(intent.baseline, observed.event)) throw new ProviderEventWriteError("provider-conflict");
          if (!(await checkDestination())) return;
          remoteSnapshot = null;
          mutationStarted = true;
          observed = await adapter.writeOccurrence(row.userID, row.accountID, row.externalCalendarID, intent, event, expectedRef, signal);
        }
        resultRef = observed.ref;
        signal.throwIfAborted();
        await completeEventOutbox(row.id, token, resultRef, expectedRef, { isEcho: true, externalEventId: resultRef.externalEventId, etag: resultRef.etag ?? null, deleted: false, providerState: observed.state, observedAt: new Date().toISOString() });
        remoteSnapshot = null;
        return;
      }
      if (row.payload.rsvp) {
        if (!config.api.providerRsvpEditsEnabled || row.provider !== "google" || row.action !== "update" || !adapter?.writeRsvp) throw new EventWriteError("event-write", "unsupported");
        if (!(await checkDestination())) return;
        const requireSource = async () => {
          signal.throwIfAborted();
          if (!(await hasProviderRsvpSource(row))) throw new ProviderEventWriteError("provider-conflict", mutationStarted ? "unconfirmed" : "not-written");
        };
        await requireSource();
        const intent = row.payload.rsvp;
        const request = ProviderRsvpEditSchema.parse(intent.request);
        if (request.expectedRevision !== row.revision || !isDeepStrictEqual(intent.desiredState, providerRsvpDesiredState(intent.baselineState, row.externalCalendarID, request.response))) throw new ProviderEventWriteError("provider-conflict");
        expectedRef = { externalEventId: row.externalEventID!, etag: row.expectedEtag };
        const evidence = googleRsvpEvidence(intent.baseline, { eventId: expectedRef.externalEventId, etag: expectedRef.etag ?? "", authenticatedCopyEmail: row.externalCalendarID, ...(intent.instance ? { occurrence: { externalSeriesID: intent.instance.externalSeriesID, originalStart: intent.instance.originalStart } } : {}) }, intent.request.response);
        const native = googleRsvpEventEvidence(evidence);
        if (!isDeepStrictEqual(intent.nativeTime, native.timeModel) || !isDeepStrictEqual(googleEventState(evidence.baseline), intent.baselineState) || !matchesRsvpEventProjection(row.provider, event, native, intent.instance)) throw new ProviderEventWriteError("provider-conflict");
        const observed = await adapter.writeRsvp(row.userID, row.accountID, row.externalCalendarID, evidence, { sendUpdates: intent.request.sendUpdates }, signal, async () => {
          await requireSource();
          mutationStarted = true;
        });
        resultRef = { externalEventId: expectedRef.externalEventId, etag: observed.etag };
        signal.throwIfAborted();
        await completeProviderRsvpOutbox(row.id, token, resultRef, expectedRef, { isEcho: true, externalEventId: resultRef.externalEventId, etag: observed.etag, deleted: false, providerState: intent.desiredState, observedAt: new Date().toISOString() });
        return;
      }
      if (row.payload.reminderEdit) {
        if (!config.api.providerReminderEditsEnabled || event.timeModel?.kind === "floating" || event.recurrence || event.seriesID || event.originalStart || event.isCanceled) throw new EventWriteError("event-write", "unsupported");
        const intent = ProviderReminderEditSchema.parse(row.payload.reminderEdit);
        if (row.action !== "update" || row.provider !== intent.provider || !adapter?.readReminderState || !adapter.writeReminders)
          throw new EventWriteError("event-write", "unsupported");
        if (!(await checkDestination())) return;
        if (!(await hasEventOutboxRevisionCoverage(row))) throw new ProviderEventWriteError("provider-conflict");
        expectedRef = await getEventOutboxExpectedRef(row);
        if (!expectedRef) throw new ProviderEventWriteError("provider-version-unavailable");
        let observed = await adapter.readReminderState(row.userID, row.accountID, row.externalCalendarID, expectedRef, signal);
        remoteSnapshot = { externalEventId: expectedRef.externalEventId, etag: observed?.ref.etag ?? null, deleted: !observed, observedAt: new Date().toISOString(), ...(observed ? { providerState: observed.state, values: JSON.parse(JSON.stringify(observed.event)) } : {}) };
        if (!observed || !matchesReminderEvent(row.provider, event, observed.event)) throw new ProviderEventWriteError("provider-conflict");
        if (!matchesReminderIntent(intent.reminders, observed.state)) {
          if (observed.ref.etag !== expectedRef.etag) throw new ProviderEventWriteError("provider-conflict");
          if (!(await checkDestination())) return;
          signal.throwIfAborted();
          remoteSnapshot = null; // accepted baseline is not a remote conflict after an ambiguous write
          mutationStarted = true;
          observed = await adapter.writeReminders(row.userID, row.accountID, row.externalCalendarID, expectedRef, intent.reminders, signal);
          if (!matchesReminderIntent(intent.reminders, observed.state)) throw new ProviderEventWriteError("provider-write-failed", "unconfirmed");
        }
        if (!matchesReminderEvent(row.provider, event, observed.event)) {
          remoteSnapshot = { externalEventId: observed.ref.externalEventId, etag: observed.ref.etag ?? null, deleted: false, providerState: observed.state, values: JSON.parse(JSON.stringify(observed.event)), observedAt: new Date().toISOString() };
          throw new ProviderEventWriteError("provider-conflict", mutationStarted ? "unconfirmed" : "not-written");
        }
        resultRef = observed.ref;
        signal.throwIfAborted();
        await completeEventOutbox(row.id, token, resultRef, expectedRef, { isEcho: true, externalEventId: resultRef.externalEventId, etag: resultRef.etag ?? null, deleted: false, providerState: observed.state, observedAt: new Date().toISOString() });
        remoteSnapshot = null;
        return;
      }
      if (hasKnownEventTime(event))
        throw new EventWriteError("event-write", "unsupported");
      if (!adapter?.assertEventWrite)
        throw new EventWriteError("event-write", "unsupported");
      const projected = adapter.projectEvent?.(event);
      const expected = projected
        ? {
            ...event,
            title: projected.title,
            start: projected.start,
            end: projected.end,
            isAllDay: projected.isAllDay,
            description: projected.description,
            location: projected.location,
            recurrence: projected.recurrence,
          }
        : event;
      if (
        projected &&
        !(await setEventOutboxProjection(row.id, token, projected))
      )
        return;
      if (!(await checkDestination())) return;
      if (
        row.action !== "delete" &&
        !(await hasEventOutboxRevisionCoverage(row))
      )
        throw new ProviderEventWriteError(
          "provider-write-failed",
          row.reconciling ? "unconfirmed" : "not-written",
        );
      expectedRef = await getEventOutboxExpectedRef(row);
      const identity =
        row.payload.createIdentityVersion === 1
          ? { operationID: row.id, signal }
          : undefined;
      if (identity && row.action === "create") {
        const knownID =
          row.provider === "google"
            ? googleEventCreateID(identity)
            : row.provider === "caldav"
              ? caldavEventCreateIdentity(row.externalCalendarID, identity).url
              : undefined;
        if (knownID && (await getEventOutboxDeletion(row, knownID))) {
          remoteSnapshot = snapshot({ externalEventId: knownID }, null);
          throw new ProviderEventWriteError("provider-conflict");
        }
      }
      const patch = revivePatch(row.payload.patch);
      let recovered = false;
      if (row.reconciling || row.action === "delete") {
        if (row.action === "create") {
          if (!identity || !adapter.findCreatedEvent) {
            await finishEventOutbox(
              row.id,
              token,
              "blocked",
              "create-recovery-unavailable",
              { uncertain: true },
            );
            return;
          }
          const evidence = await adapter.findCreatedEvent(
            row.userID,
            row.accountID,
            row.externalCalendarID,
            identity,
          );
          if (evidence) {
            remoteSnapshot = snapshot(evidence.ref, evidence);
            if (!matchesDeliveredEvent(row.provider, expected, evidence.event))
              throw new ProviderEventWriteError("provider-conflict");
            resultRef = evidence.ref;
            remoteSnapshot = null;
            recovered = true;
          } else if (row.provider !== "google" && row.provider !== "caldav") {
            await finishEventOutbox(
              row.id,
              token,
              "blocked",
              "create-outcome-unknown",
              { uncertain: true },
            );
            return;
          }
        } else if (expectedRef) {
          if (!adapter.readEvent)
            throw new EventWriteError("event-write", "unsupported");
          const evidence = await adapter.readEvent(
            row.userID,
            row.accountID,
            row.externalCalendarID,
            expectedRef,
            signal,
          );
          remoteSnapshot = snapshot(expectedRef, evidence);
          if (!evidence && row.action === "delete") recovered = true;
          else if (
            evidence &&
            row.action === "update" &&
            matchesDeliveredEvent(row.provider, expected, evidence.event)
          ) {
            resultRef = evidence.ref;
            recovered = true;
          } else if (
            evidence &&
            strongEventEtag(expectedRef.etag) &&
            evidence.ref.etag === expectedRef.etag
          ) {
            // A differing accepted version still needs the conditional write.
          } else throw new ProviderEventWriteError("provider-conflict");
          remoteSnapshot = null;
        } else if (row.predecessorID) {
          throw new ProviderEventWriteError("provider-version-unavailable");
        }
      }
      if (!recovered) {
        if (row.action !== "create" && !expectedRef) {
          if (row.predecessorID)
            throw new ProviderEventWriteError("provider-version-unavailable");
          await completeEventOutbox(row.id, token, null, null);
          return;
        }
        await adapter.assertEventWrite(
          row.userID,
          row.accountID,
          row.externalCalendarID,
          {
            action: row.action,
            event,
            patch,
            external: expectedRef ?? undefined,
            scopeEditValidated: row.payload.scopeEditValidated,
            signal,
          },
        );
        if (!(await checkDestination())) return;
        signal.throwIfAborted();
        mutationStarted = true;
        if (row.action === "create") {
          resultRef = await adapter.pushCreate(
            row.userID,
            row.accountID,
            row.externalCalendarID,
            event,
            identity,
          );
        } else if (row.action === "update") {
          const result = await adapter.pushUpdate(
            row.userID,
            row.accountID,
            row.externalCalendarID,
            expectedRef!.externalEventId,
            event,
            expectedRef!,
            patch,
            signal,
          );
          resultRef = result
            ? {
                externalEventId: expectedRef!.externalEventId,
                etag: result.etag ?? null,
                icalUid: result.icalUid ?? expectedRef!.icalUid,
              }
            : expectedRef;
        } else {
          await adapter.pushDelete(
            row.userID,
            row.accountID,
            row.externalCalendarID,
            expectedRef!.externalEventId,
            expectedRef!,
            signal,
          );
        }
      }
      signal.throwIfAborted();
      await completeEventOutbox(row.id, token, resultRef, expectedRef);
    };
    await Promise.race([
      run().catch(async (error) => {
        if (
          error instanceof ProviderEventWriteError &&
          error.code === "provider-conflict" &&
          !row.payload.caldavSeries &&
          !remoteSnapshot &&
          expectedRef &&
          adapter?.readEvent &&
          !signal.aborted
        ) {
          try {
            const observed = await adapter.readEvent(
              row.userID,
              row.accountID,
              row.externalCalendarID,
              expectedRef,
              signal,
            );
            remoteSnapshot = snapshot(expectedRef, observed);
          } catch {
            /* Keep the conflict; absence of readable evidence is not resolution. */
          }
        }
        throw error;
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(
            new ProviderEventWriteError("provider-write-failed", "unconfirmed"),
          );
        }, options.timeoutMs ?? 45_000);
      }),
    ]);
  } catch (error) {
    const providerError =
      error instanceof ProviderEventWriteError ? error : undefined;
    const uncertain =
      row.reconciling ||
      (mutationStarted && providerError?.outcome !== "not-written");
    const conflict = providerError?.code === "provider-conflict";
    const retryableStatus =
      providerError?.providerStatus === 429 ||
      providerError?.providerStatus === 408 ||
      (providerError?.providerStatus ?? 0) >= 500;
    const blocked =
      error instanceof EventWriteError ||
      (error instanceof ProviderAuthError && error.reconnectRequired) ||
      (providerError &&
        !conflict &&
        !retryableStatus &&
        providerError.outcome !== "unconfirmed");
    const delay = Math.max(
      providerError?.retryAfterMs ?? 0,
      Math.min(3_600_000, 1_000 * 2 ** Math.min(row.attempts, 12)) *
        (0.75 + Math.random() * 0.5),
    );
    await finishEventOutbox(
      row.id,
      token,
      conflict
        ? "conflict"
        : blocked
          ? "blocked"
          : uncertain
            ? "unconfirmed"
            : "retry",
      providerError?.code ??
        (error instanceof ProviderAuthError && error.reconnectRequired
          ? "provider-reconnect-required"
          : error instanceof EventWriteError
            ? error.reason === "unknown"
              ? "provider-permission-unknown"
              : `provider-write-${error.reason}`
            : blocked
              ? "provider-permission-unavailable"
              : "provider-write-failed"),
      {
        uncertain,
        nextAttemptAt: new Date(
          Date.now() + Math.min(delay, 8.64e15 - Date.now()),
        ),
        ...(remoteSnapshot ? { remoteSnapshot } : {}),
        ...(resultRef ? { resultRef } : {}),
      },
    );
  } finally {
    clearInterval(heartbeat);
    if (timeout) clearTimeout(timeout);
    controller.abort();
  }
  return getEventOutboxRow(row.id);
}
