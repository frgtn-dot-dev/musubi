import { isDeepStrictEqual } from "node:util";
import { config } from "@musubi/config";
import { BadRequestError, EventWriteError } from "@musubi/types";
import { prepareProviderRsvpEdit, commitProviderRsvpEdit, matchesRsvpEventProjection } from "@musubi/db";
import { googleAdapter } from "./adapters/google";
import { googleRsvpEventEvidence } from "./adapters/google_rsvp_projection";
import { googleEventState } from "./adapters/provider_event_state";

/** Prepare a durable intent without sending the RSVP in the HTTP request. Never call provider
 * mutation inside a DB transaction or replace a stale prepared baseline. */
export async function queueGoogleRsvp(actorID: string, eventID: string, input: unknown) {
  if (!config.api.providerRsvpEditsEnabled) throw new EventWriteError("event-write", "unsupported");
  const prepared = await prepareProviderRsvpEdit(actorID, eventID, input);
  if (prepared.kind === "replay") return prepared.receipt;
  const context = prepared.context;
  if (context.request.provider !== "google") throw new EventWriteError("event-write", "unsupported");
  const evidence = await googleAdapter.readRsvp!(actorID, context.accountID, context.externalCalendarID, { externalEventId: context.externalEventID, etag: context.etag }, context.request.response, AbortSignal.timeout(10_000), context.instance ? { externalSeriesID: context.instance.externalSeriesID, originalStart: context.instance.originalStart } : undefined);
  const native = googleRsvpEventEvidence(evidence);
  if (!matchesRsvpEventProjection("google", context.event, native, context.instance) || !isDeepStrictEqual(context.state, googleEventState(evidence.baseline)))
    throw new BadRequestError("Provider meeting changed. Sync and reopen before responding.");
  return commitProviderRsvpEdit(context, evidence.baseline, native.timeModel!);
}

async function caldavEvidence(context: import("@musubi/db").ProviderRsvpContext) {
  const { caldavAdapter } = await import("./adapters/caldav");
  const { normalizeCaldavResource } = await import("./adapters/caldav_time");
  const { caldavRsvpState } = await import("./adapters/caldav_rsvp");
  const evidence = await caldavAdapter.readCaldavRsvp!(context.actorID, context.accountID, context.externalCalendarID, { externalEventId: context.externalEventID, etag: context.etag, icalUid: context.icalUid }, context.request.response, AbortSignal.timeout(10_000));
  const native = normalizeCaldavResource({ url: evidence.id, etag: evidence.etag, data: evidence.before })[0]!;
  if (!matchesRsvpEventProjection("caldav", context.event, native) || !isDeepStrictEqual(context.state, caldavRsvpState(evidence.before))) throw new BadRequestError("Provider meeting changed. Sync and reopen before responding.");
  return { evidence, native };
}
export async function queueProviderRsvp(actorID: string, eventID: string, input: unknown) {
  const { ProviderRsvpEditSchema } = await import("@musubi/types");
  const request = ProviderRsvpEditSchema.parse(input);
  if (request.provider === "google") return queueGoogleRsvp(actorID, eventID, request);
  if (!config.api.providerRsvpEditsEnabled) throw new EventWriteError("event-write", "unsupported");
  const prepared = await prepareProviderRsvpEdit(actorID, eventID, request);
  if (prepared.kind === "replay") return prepared.receipt;
  if (request.provider === "microsoft") {
    const { microsoftAdapter } = await import("./adapters/microsoft");
    const { microsoftRsvpProjection } = await import("./adapters/microsoft_rsvp");
    const { microsoftEventState } = await import("./adapters/provider_event_state");
    const context = prepared.context;
    const evidence = await microsoftAdapter.readMicrosoftRsvp!(actorID, context.accountID, context.externalCalendarID, { externalEventId: context.externalEventID, etag: context.etag, icalUid: context.icalUid }, request.response, AbortSignal.timeout(10_000));
    const native = microsoftRsvpProjection(evidence);
    if (!matchesRsvpEventProjection("microsoft", context.event, native) || !isDeepStrictEqual(context.state, microsoftEventState(evidence.native))) throw new BadRequestError("Provider meeting changed. Sync and reopen before responding.");
    return commitProviderRsvpEdit(context, evidence, native.timeModel!);
  }
  const { evidence, native } = await caldavEvidence(prepared.context).catch(() => { throw new BadRequestError("Calendar scheduling could not be verified. Sync and reopen before responding."); });
  return commitProviderRsvpEdit(prepared.context, evidence, native.timeModel!);
}
/** The public button is offered only after a fresh scheduling/self proof. Raw
 * resources, principal URLs and private account evidence never leave the API. */
export async function observeCaldavRsvp(actorID: string, eventID: string, observation: import("@musubi/types").ProviderEventStateResponse) {
  if (observation.rsvpEdit?.provider !== "caldav" || !observation.version || !observation.state) return observation;
  try {
    const { randomUUID } = await import("node:crypto");
    const prepared = await prepareProviderRsvpEdit(actorID, eventID, { operationID: randomUUID(), provider: "caldav", response: "accepted", notificationPolicy: "server-reply", expectedRevision: observation.rsvpEdit.expectedRevision, expectedStateVersion: observation.version });
    if (prepared.kind !== "prepared") throw new Error("Unexpected observation replay");
    const { evidence } = await caldavEvidence(prepared.context);
    const self = observation.state.attendees.find(item => item.address?.toLowerCase() === evidence.selfAddress);
    return { ...observation, state: { ...observation.state, isOrganizer: false, ownResponse: self?.response?.toLowerCase() === "needs-action" ? "needsAction" : self?.response?.toLowerCase() ?? "needsAction" } };
  } catch {
    const { rsvpEdit: _rsvpEdit, ...withoutAction } = observation;
    return withoutAction;
  }
}

export async function observeMicrosoftRsvp(actorID: string, eventID: string, observation: import("@musubi/types").ProviderEventStateResponse) {
  if (observation.rsvpEdit?.provider !== "microsoft" || !observation.version || !observation.state) return observation;
  try {
    const { randomUUID } = await import("node:crypto");
    const prepared = await prepareProviderRsvpEdit(actorID, eventID, { operationID: randomUUID(), provider: "microsoft", response: "accepted", notificationPolicy: "send-response", expectedRevision: observation.rsvpEdit.expectedRevision, expectedStateVersion: observation.version });
    if (prepared.kind !== "prepared") throw new Error("Unexpected replay");
    const { microsoftAdapter } = await import("./adapters/microsoft");
    const { microsoftRsvpProjection } = await import("./adapters/microsoft_rsvp");
    const context = prepared.context;
    const evidence = await microsoftAdapter.readMicrosoftRsvp!(actorID, context.accountID, context.externalCalendarID, { externalEventId: context.externalEventID, etag: context.etag, icalUid: context.icalUid }, "accepted", AbortSignal.timeout(10_000));
    if (!matchesRsvpEventProjection("microsoft", context.event, microsoftRsvpProjection(evidence)) || !isDeepStrictEqual(context.state, microsoftRsvpProjection(evidence).providerState)) throw new Error("Changed event");
    return observation;
  } catch { const { rsvpEdit: _rsvpEdit, ...rest } = observation; return rest; }
}
