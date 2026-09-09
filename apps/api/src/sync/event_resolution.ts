import { googleReminderInstanceProjection } from "./adapters/google_reminder_instance";
import { providerReminderDesiredState } from "@musubi/types";
import { planEventScope } from "@musubi/calendar";
import { googleRsvpEventEvidence } from "./adapters/google_rsvp_projection";
import { googleEventState } from "./adapters/provider_event_state";
import { config } from "@musubi/config";
import {
  diffEventContent,
  matchesReminderEventProjection,
  providerStateVersion,
  providerRsvpBaselineVersion,
  matchesRsvpEventProjection,
  getEventDeliveryResolutionContext,
  getEventOutboxExpectedRef,
  getEventOutboxDeletion,
  EventDeliveryResolutionError,
  type EventDeliveryResolutionProof,
  type EventDeliveryResolutionContext,
} from "@musubi/db";
import {
  EventWriteError,
  EventSchema,
  ProviderReminderEditSchema,
  ProviderRsvpEditSchema, providerRsvpDesiredState,
  type EventDeliveryConflict,
  type EventDeliveryContent,
  type Event,
} from "@musubi/types";
import { getAdapter } from "./engine";
import type {
  CalendarAdapter,
  CreatedEventEvidence,
  ExternalEventRef,
} from "./adapter";
import {
  googleEventCreateID,
  caldavEventCreateIdentity,
} from "./event_create_identity";
import { prepareCaldavSeriesSplit, prepareCaldavSeriesDeletion, prepareCaldavSeriesWrite } from "./adapters/caldav";
import { strongEventEtag, requireEventEtag } from "./event_write";
import { ProviderAuthError } from "./errors";

function content(
  event: Pick<
    Event,
    | "title"
    | "start"
    | "end"
    | "isAllDay"
    | "description"
    | "location"
    | "recurrence"
  >,
): EventDeliveryContent {
  return {
    title: event.title,
    start: event.start,
    end: event.end,
    isAllDay: event.isAllDay,
    description: event.description ?? null,
    location: event.location ?? null,
    recurrence: event.recurrence ?? null,
  };
}

function refusal(error: unknown): EventDeliveryConflict["reason"] {
  if (error instanceof ProviderAuthError && error.reconnectRequired)
    return "reconnect-required";
  if (error instanceof EventWriteError)
    return error.reason === "unknown"
      ? "permission-unknown"
      : `write-${error.reason}`;
  return "recovery-unavailable";
}

/** Read-only preview and proof preparation. Only the receipt owner may reach
 * provider reads. A later POST performs this again; client ETags are comparisons,
 * never new resource addresses or instructions to bypass conditional writes. */
export async function prepareEventDeliveryResolution(
  userID: string,
  eventID: string,
  operationID: string,
  adapterFor: (provider: string) => CalendarAdapter | null = getAdapter,
): Promise<{
  preview: EventDeliveryConflict;
  proof: EventDeliveryResolutionProof;
}> {
  const context = await getEventDeliveryResolutionContext(
    userID,
    eventID,
    operationID,
  );
  const adapter = adapterFor(context.row.provider);
  if (!adapter)
    throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      prepare(context, adapter, controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(
            new EventDeliveryResolutionError("delivery-resolution-unavailable"),
          );
        }, 12_000);
      }),
    ]);
  } catch {
    throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
  } finally {
    if (timeout) clearTimeout(timeout);
    controller.abort();
  }
}

async function prepare(
  context: EventDeliveryResolutionContext,
  adapter: CalendarAdapter,
  signal: AbortSignal,
) {
  const { row } = context;
  if (context.caldavSplitFutureSnapshot) {
    if (!config.api.eventTimeEditsEnabled || !adapter.readCaldavSplitFuture) throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const before = context.caldavSplitFutureSnapshot, { journal } = before;
    const observed = await adapter.readCaldavSplitFuture(row.userID, row.accountID, row.externalCalendarID, journal.prepared.split, signal);
    const preview: EventDeliveryConflict = {
      eventId: row.eventID, operationId: row.id, latestOperationId: row.id, localRevision: journal.after.head.revision!,
      local: { ...content(journal.after.head), timeModel: journal.after.head.timeModel ?? undefined },
      remote: observed ? { ...content(journal.after.head), timeModel: journal.after.head.timeModel ?? undefined } : null,
      scopeResolution: { kind: "following-create", originalStart: journal.prepared.split.request.originalStart!, newSeriesId: journal.after.head.id },
      remoteEtag: observed?.ref.etag ?? null, action: "create", canResolve: true, reason: null,
    };
    const proof: EventDeliveryResolutionProof = { context, ref: observed?.ref ?? null, remoteExists: !!observed, action: "create", patch: {}, deletion: undefined, caldavSplitFuture: { before } };
    return { preview, proof };
  }
  let ref: ExternalEventRef | null = await getEventOutboxExpectedRef(row);
  if (row.action === "create") {
    if (row.payload.createIdentityVersion !== 1 || !adapter.findCreatedEvent)
      throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const identity = { operationID: row.id, signal };
    ref =
      row.provider === "google"
        ? { externalEventId: googleEventCreateID(identity) }
        : row.provider === "caldav"
          ? {
              externalEventId: caldavEventCreateIdentity(
                row.externalCalendarID,
                identity,
              ).url,
            }
          : null;
  }
  if (row.payload.rsvp) {
    if (!config.api.providerRsvpEditsEnabled || !adapter.readRsvpResolution || !ref || context.deleted || !context.mapping)
      throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const request = ProviderRsvpEditSchema.parse(row.payload.rsvp.request);
    const deletion = await getEventOutboxDeletion(row, ref.externalEventId);
    const evidence = await adapter.readRsvpResolution(row.userID, row.accountID, row.externalCalendarID, ref, request.response, signal, context.providerInstance ? { externalSeriesID: context.providerInstance.externalSeriesID, originalStart: context.providerInstance.originalStart } : undefined);
    const native = googleRsvpEventEvidence(evidence);
    if (evidence.baseline.id !== ref.externalEventId || !strongEventEtag(evidence.baseline.etag) || !matchesRsvpEventProjection("google", context.local, native, context.providerInstance) || !native.timeModel)
      throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const state = googleEventState(evidence.baseline);
    const baselineVersion = providerRsvpBaselineVersion(context.mapping.id, evidence.baseline, context.providerInstance);
    const currentRef = { externalEventId: evidence.baseline.id, etag: evidence.baseline.etag };
    const preview: EventDeliveryConflict = {
      eventId: row.eventID, operationId: row.id, latestOperationId: context.latest.id,
      localRevision: context.localRevision, local: { ...content(context.local), timeModel: context.local.timeModel ?? undefined },
      remote: { ...content(native), timeModel: native.timeModel }, remoteEtag: currentRef.etag,
      action: "update", canResolve: true, reason: null,
      rsvpResolution: { desired: request.response, remote: state.ownResponse, baselineVersion },
    };
    const proof: EventDeliveryResolutionProof = { context, ref: currentRef, remoteExists: true, action: "update", patch: {}, deletion,
      rsvp: { baselineVersion, intent: { request, baseline: evidence.baseline, nativeTime: native.timeModel, ...(context.providerInstance ? { instance: context.providerInstance } : {}), baselineState: state, desiredState: providerRsvpDesiredState(state, evidence.selfEmail, request.response), mappingID: context.mapping.id } } };
    return { preview, proof };
  }
  if (row.payload.reminderInstance) {
    if (!config.api.providerReminderEditsEnabled || !adapter.reminderInstance || !ref || context.deleted || !context.mapping || !context.providerInstance)
      throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const request = ProviderReminderEditSchema.parse(row.payload.reminderInstance.request);
    const deletion = await getEventOutboxDeletion(row, ref.externalEventId);
    const binding = context.providerInstance;
    const evidence = await adapter.reminderInstance.readResolution(row.userID, row.accountID, row.externalCalendarID, ref.externalEventId, { externalSeriesID: binding.externalSeriesID, originalStart: binding.originalStart }, request.reminders, signal);
    const native = googleReminderInstanceProjection(evidence);
    if (!matchesRsvpEventProjection("google", context.local, native, binding) || !native.timeModel) throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const state = googleEventState(evidence.baseline);
    if (state.reminders.provider !== "google") throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const stateVersion = providerRsvpBaselineVersion(context.mapping.id, evidence.baseline, binding);
    const currentRef = { externalEventId: evidence.baseline.id, etag: evidence.baseline.etag };
    const preview: EventDeliveryConflict = {
      eventId: row.eventID, operationId: row.id, latestOperationId: context.latest.id,
      localRevision: context.localRevision, local: { ...content(context.local), timeModel: context.local.timeModel ?? undefined },
      remote: { ...content(native), timeModel: native.timeModel }, remoteEtag: currentRef.etag,
      action: "update", canResolve: true, reason: null,
      reminderResolution: { desired: request.reminders, remote: state.reminders, stateVersion },
    };
    const proof: EventDeliveryResolutionProof = { context, ref: currentRef, remoteExists: true, action: "update", patch: {}, deletion,
      reminder: { intent: request, state, stateVersion, instance: { request, baseline: evidence.baseline, nativeTime: native.timeModel, instance: binding, baselineState: state, desiredState: providerReminderDesiredState(state, request.reminders), mappingID: context.mapping.id } } };
    return { preview, proof };
  }
  if (row.payload.reminderEdit) {
    if (!config.api.providerReminderEditsEnabled || !adapter.readReminderState || !ref || context.deleted || !context.mapping)
      throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const deletion = await getEventOutboxDeletion(row, ref.externalEventId);
    const observed = await adapter.readReminderState(row.userID, row.accountID, row.externalCalendarID, ref, signal);
    if (!observed || observed.ref.externalEventId !== ref.externalEventId || !strongEventEtag(observed.ref.etag) || observed.event.status !== "active" || !matchesReminderEventProjection("google", context.local, observed.event) || observed.state.provider !== "google" || observed.state.reminders.provider !== "google")
      throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const intent = ProviderReminderEditSchema.parse(row.payload.reminderEdit);
    const stateVersion = providerStateVersion({ id: context.mapping.id, etag: observed.ref.etag!, providerState: observed.state })!;
    const preview: EventDeliveryConflict = {
      eventId: row.eventID, operationId: row.id, latestOperationId: context.latest.id,
      localRevision: context.localRevision, local: { ...content(context.local), timeModel: context.local.timeModel ?? undefined },
      remote: { ...content(observed.event), timeModel: observed.event.timeModel }, remoteEtag: observed.ref.etag!,
      action: "update", canResolve: true, reason: null,
      reminderResolution: { desired: intent.reminders, remote: observed.state.reminders, stateVersion },
    };
    const proof: EventDeliveryResolutionProof = { context, ref: observed.ref, remoteExists: true, action: "update", patch: {}, deletion, reminder: { intent, state: observed.state, stateVersion } };
    return { preview, proof };
  }
  if (row.payload.caldavSplit) {
    if (!config.api.eventTimeEditsEnabled || !context.caldavSplitSnapshot || !adapter.readCaldavSeriesResolution || !adapter.assertCaldavSplitCreation || !ref || context.deleted)
      throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const snapshot = context.caldavSplitSnapshot, saved = snapshot.journal.prepared;
    const observed = await adapter.readCaldavSeriesResolution(row.userID, row.accountID, row.externalCalendarID, { ...saved.split.source.baseline, ref }, saved.split.source.before, signal, null);
    const split = prepareCaldavSeriesSplit(observed.evidence, observed.baseline, saved.split.request, saved.split.creation.master.id);
    await adapter.assertCaldavSplitCreation(row.userID, row.accountID, row.externalCalendarID, split, signal);
    const prepared = { context: { ...saved.context, mappings: saved.context.mappings.map(item => ({ ...item, etag: requireEventEtag(observed.evidence.ref.etag) })) }, split };
    const preview: EventDeliveryConflict = {
      eventId: row.eventID, operationId: row.id, latestOperationId: row.id, localRevision: snapshot.journal.after.source.revision!,
      local: { ...content(snapshot.journal.after.source), timeModel: snapshot.journal.after.source.timeModel ?? undefined },
      remote: { ...content(observed.baseline.master), timeModel: observed.baseline.master.timeModel ?? undefined },
      splitFuture: { ...content(snapshot.journal.after.head), timeModel: snapshot.journal.after.head.timeModel ?? undefined },
      scopeResolution: { kind: "following-update", originalStart: split.request.originalStart!, newSeriesId: split.creation.master.id },
      remoteEtag: observed.evidence.ref.etag!, action: "update", canResolve: true, reason: null,
    };
    const proof: EventDeliveryResolutionProof = { context, ref: observed.evidence.ref, remoteExists: true, action: "update", patch: {}, deletion: await getEventOutboxDeletion(row, ref.externalEventId), caldavSplit: { before: snapshot, prepared } };
    return { preview, proof };
  }
  if (row.payload.caldavSeriesDeletion) {
    if (!config.api.eventTimeEditsEnabled || !adapter.readCaldavSeriesDeletionResolution || !context.caldavContext || !ref || !context.deleted)
      throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const saved = row.payload.caldavSeriesDeletion.deletion;
    const observed = await adapter.readCaldavSeriesDeletionResolution(row.userID, row.accountID, row.externalCalendarID, { ...saved.baseline, ref }, saved.before, signal);
    const prepared = {
      context: { ...context.caldavContext, mappings: context.caldavContext.mappings.map(item => ({ ...item, etag: requireEventEtag(observed.evidence.ref.etag) })) },
      deletion: prepareCaldavSeriesDeletion(observed.evidence, observed.baseline),
    };
    const preview: EventDeliveryConflict = {
      eventId: row.eventID, operationId: row.id, latestOperationId: context.latest.id, localRevision: null,
      local: null, remote: { ...content(observed.baseline.master), timeModel: observed.baseline.master.timeModel ?? undefined },
      remoteEtag: observed.evidence.ref.etag!, action: "delete", canResolve: true, reason: null, scopeResolution: { kind: "series-delete" },
    };
    const proof: EventDeliveryResolutionProof = { context, ref: observed.evidence.ref, remoteExists: true, action: "delete", patch: {}, deletion: await getEventOutboxDeletion(row, ref.externalEventId), caldavSeriesDeletion: prepared };
    return { preview, proof };
  }
  if (row.payload.caldavSeries) {
    if (!config.api.eventTimeEditsEnabled || !adapter.readCaldavSeriesResolution || !context.caldavContext || !ref || context.deleted)
      throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const family = context.caldavContext;
    const savedWrite = row.payload.caldavSeries.write;
    const targetEventID = savedWrite.targetEventID;
    const localTarget = targetEventID ? family.children.find(child => child.id === targetEventID) : family.master;
    if (!localTarget) throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const observed = await adapter.readCaldavSeriesResolution(row.userID, row.accountID, row.externalCalendarID, { ...savedWrite.baseline, ref }, savedWrite.before, signal, savedWrite.newDefinition || savedWrite.cancelTarget || savedWrite.followingDelete ? null : targetEventID);
    let remoteTarget = targetEventID ? observed.baseline.children.find(child => child.id === targetEventID) : observed.baseline.master;
    if (savedWrite.newDefinition) {
      const generated = savedWrite.newDefinition;
      remoteTarget = planEventScope(observed.baseline.master, observed.baseline.children, {
        operationID: generated.id, scope: "occurrence", action: "update", expectedRevision: observed.baseline.master.revision,
        originalStart: generated.originalStart, expectedOccurrenceRevision: null, patch: {}, ensureDefinition: true,
      }, () => generated.id).creates[0];
    }
    if (!remoteTarget) throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const patch = savedWrite.cancelTarget || savedWrite.followingDelete ? {} : { title: localTarget.title, description: localTarget.description ?? null, location: localTarget.location ?? null, ...(savedWrite.patch.recurrence !== undefined ? { recurrence: savedWrite.patch.recurrence } : {}) };
    const prepared = {
      context: { ...family, mappings: family.mappings.map(item => ({ ...item, etag: requireEventEtag(observed.evidence.ref.etag) })) },
      write: prepareCaldavSeriesWrite(observed.evidence, observed.baseline, patch, targetEventID, savedWrite.cancelTarget, savedWrite.newDefinition, savedWrite.time, savedWrite.followingDelete),
    };
    const preview: EventDeliveryConflict = {
      eventId: row.eventID, operationId: row.id, latestOperationId: context.latest.id,
      localRevision: context.localRevision,
      ...(savedWrite.followingDelete ? { scopeResolution: { kind: "following-delete" as const, originalStart: savedWrite.followingDelete.originalStart } } : {}),
      local: { ...content(localTarget), isCanceled: localTarget.isCanceled, timeModel: localTarget.timeModel ?? undefined, originalStart: localTarget.originalStart ?? undefined },
      remote: { ...content(remoteTarget), isCanceled: remoteTarget.isCanceled, timeModel: remoteTarget.timeModel ?? undefined, originalStart: remoteTarget.originalStart ?? undefined },
      remoteEtag: observed.evidence.ref.etag!, action: "update", canResolve: true, reason: null,
    };
    const proof: EventDeliveryResolutionProof = { context, ref: observed.evidence.ref, remoteExists: true, action: "update", patch: {}, deletion: await getEventOutboxDeletion(row, ref.externalEventId), caldavSeries: prepared };
    return { preview, proof };
  }
  if (row.payload.googleOccurrence) {
    if (
      !config.api.eventTimeEditsEnabled ||
      !adapter.readOccurrence ||
      !ref ||
      context.deleted
    )
      throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const intent = {
      ...row.payload.googleOccurrence,
      master: EventSchema.parse(row.payload.googleOccurrence.master),
      baseline: EventSchema.parse(row.payload.googleOccurrence.baseline),
    };
    const deletion = await getEventOutboxDeletion(row, ref.externalEventId);
    const observed = await adapter.readOccurrence(
      row.userID,
      row.accountID,
      row.externalCalendarID,
      intent,
      ref,
      signal,
    );
    if (
      observed.ref.externalEventId !== ref.externalEventId ||
      !strongEventEtag(observed.ref.etag)
    )
      throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
    const baseline = EventSchema.parse({
      ...context.local,
      ...observed.event,
      id: context.local.id,
      organizer: context.local.organizer,
      seriesID: intent.master.id,
      calendars: context.local.calendars,
    });
    const scopeContent = (event: Event): EventDeliveryContent => ({
      ...content(event),
      isCanceled: !!event.isCanceled,
      timeModel: event.timeModel ?? undefined,
      originalStart: event.originalStart ?? undefined,
    });
    const preview: EventDeliveryConflict = {
      eventId: row.eventID,
      operationId: row.id,
      latestOperationId: context.latest.id,
      localRevision: context.localRevision,
      masterRevision: context.masterRevision,
      local: scopeContent(context.local),
      remote: scopeContent(baseline),
      remoteEtag: observed.ref.etag!,
      action: "update",
      canResolve: true,
      reason: null,
    };
    const proof: EventDeliveryResolutionProof = {
      context,
      ref: observed.ref,
      remoteExists: true,
      action: "update",
      patch: {},
      deletion,
      googleOccurrence: { ...intent, baseline },
    };
    return { preview, proof };
  }
  // Capture deletion evidence BEFORE the provider read, including deterministic
  // create IDs which have no mapping yet. A newer pull delta invalidates the CAS.
  const deletion = ref
    ? await getEventOutboxDeletion(row, ref.externalEventId)
    : undefined;
  let remote: CreatedEventEvidence | null;
  try {
    if (row.action === "create") {
      remote = await adapter.findCreatedEvent!(
        row.userID,
        row.accountID,
        row.externalCalendarID,
        { operationID: row.id, signal },
      );
    } else {
      if (!ref || !adapter.readEvent)
        throw new EventDeliveryResolutionError(
          "delivery-resolution-unavailable",
        );
      remote = await adapter.readEvent(
        row.userID,
        row.accountID,
        row.externalCalendarID,
        ref,
        signal,
      );
    }
  } catch {
    throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
  }
  signal.throwIfAborted();
  if (remote && ref && remote.ref.externalEventId !== ref.externalEventId)
    throw new EventDeliveryResolutionError("delivery-resolution-unavailable");
  if (remote) ref = remote.ref;
  const action = context.deleted ? "delete" : remote ? "update" : "create";
  const projected = adapter.projectEvent?.(context.local) ?? context.local;
  const comparison = remote
    ? diffEventContent(content(remote.event), content(projected))
    : {};
  const localContent = content(context.local);
  // Compare actual provider projection, but retain original local values in the
  // patch. Adapters still own serialization and preservation of provider fields.
  const patch = Object.fromEntries(
    Object.keys(comparison).map((key) => [
      key,
      localContent[key as keyof EventDeliveryContent],
    ]),
  );
  let reason: EventDeliveryConflict["reason"] = null;
  // Absence after an ambiguous create cannot authorize a second create identity
  // or a claimed deletion: the original request may still arrive remotely.
  if (
    (row.action === "create" &&
      !remote &&
      (row.uncertain || row.status === "unconfirmed" || row.remoteSnapshot)) ||
    (remote && !strongEventEtag(remote.ref.etag)) ||
    (action === "delete" && !ref) ||
    (row.provider === "microsoft" && row.action === "create")
  ) {
    reason = "recovery-unavailable";
  } else {
    try {
      if (
        !(action === "delete" && !remote) &&
        !(action === "update" && remote && Object.keys(comparison).length === 0)
      ) {
        if (!adapter.assertEventWrite)
          throw new EventWriteError("event-write", "unsupported");
        await adapter.assertEventWrite(
          row.userID,
          row.accountID,
          row.externalCalendarID,
          {
            action,
            event: context.local,
            patch,
            ...(action !== "create" && ref ? { external: ref } : {}),
            signal,
          },
        );
      }
    } catch (error) {
      reason = refusal(error);
    }
  }
  signal.throwIfAborted();
  const preview: EventDeliveryConflict = {
    eventId: row.eventID,
    operationId: row.id,
    latestOperationId: context.latest.id,
    localRevision: context.localRevision,
    local: context.deleted ? null : localContent,
    remote: remote ? content(remote.event) : null,
    remoteEtag: remote?.ref.etag ?? null,
    action,
    canResolve: reason === null,
    reason,
  };
  const proof: EventDeliveryResolutionProof = {
    context,
    ref,
    remoteExists: !!remote,
    action,
    patch,
    deletion,
  };
  return { preview, proof };
}
