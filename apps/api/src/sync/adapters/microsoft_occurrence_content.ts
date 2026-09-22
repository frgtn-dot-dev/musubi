import { updateGraphSeriesContent } from "./microsoft_series_content";
import { graphOriginalStartFromUtc } from "./microsoft_time";
import { type MicrosoftOccurrenceContentRequest } from "@musubi/types";
import { assertGraphMeetingRequest, graphMeetingVersion, graphOccurrenceContentObserved, sameCaldavScopeContext as same, type GraphMeetingContext, type GraphOccurrenceContent } from "@musubi/db";
import { ProviderEventWriteError } from "../event_write";
import { graphOrganizerFamilySession, observeGraphOrganizerFamily } from "./microsoft_meeting_cancel";
import { microsoftMeetingContentEvidence, microsoftMeetingContentBody, matchesMeetingContent } from "./microsoft_organizer";

function fail(): never { throw new ProviderEventWriteError("provider-conflict"); }
const unknown = (): never => { throw new ProviderEventWriteError("provider-write-failed", "unconfirmed"); };

export async function observeGraphOccurrenceContent(token: string, context: GraphMeetingContext, signal?: AbortSignal) {
  const mapping = context.mappings.find(m => m.eventID === context.address.eventID);
  if (!mapping?.externalSeriesID || mapping.externalSeriesID !== context.masterID) fail();
  const family = await observeGraphOrganizerFamily(token, context, signal, true);
  const transport = await graphOrganizerFamilySession(token, context, signal, true);
  if (!same(family.identity, transport.identity)) fail();
  const native = microsoftMeetingContentEvidence(await transport.get(transport.path(mapping.externalEventID) + "?$select=*,originalStart"), transport.identity.selfAddress, context.masterID);
  const target = family.baseline.instances.find(n => n.externalID === mapping.externalEventID);
  if (!target || native.id !== target.externalID || native.iCalUId !== target.icalUid || native.etag !== target.etag || !same(graphOriginalStartFromUtc(String(native.originalStart), native.isAllDay), target.originalStart)) fail();
  return { ...family, native, version: graphMeetingVersion({ context, baseline: family.baseline, identity: family.identity, native }) };
}

export async function prepareGraphOccurrenceContent(token: string, context: GraphMeetingContext, request: MicrosoftOccurrenceContentRequest, signal?: AbortSignal): Promise<GraphOccurrenceContent> {
  assertGraphMeetingRequest(context, request);
  const observed = await observeGraphOccurrenceContent(token, context, signal);
  if (observed.version !== request.expectedSeriesVersion) fail();
  return { version: 1, context, request, baseline: observed.baseline, native: observed.native, identity: observed.identity, template: observed.template, targetID: observed.native.id };
}

/** Conditional PATCH only targets one native occurrence. Never re-send after a
 * possible dispatch: meeting updates may notify guests on every successful write. */
export async function updateGraphOccurrenceContent(token: string, saved: GraphOccurrenceContent, mark: () => Promise<void>, accepted: () => Promise<void>, signal?: AbortSignal) {
  if (saved.request.scope === "series") return updateGraphSeriesContent(token, saved, mark, accepted, signal);
  const transport = await graphOrganizerFamilySession(token, saved.context, signal, true);
  if (!same(transport.identity, saved.identity)) fail();
  const baseline = microsoftMeetingContentEvidence(saved.native, saved.identity.selfAddress, saved.context.masterID);
  const target = saved.baseline.instances.find(n => n.externalID === saved.targetID);
  if (!target || target.etag !== baseline.etag || target.icalUid !== baseline.iCalUId || saved.targetID !== baseline.id) fail();
  const patch = microsoftMeetingContentBody(saved.request);
  const read = async () => {
    const family = await transport.read(saved.template, saved.baseline.master.icalUid);
    const native = await transport.get(transport.path(saved.targetID) + "?$select=*,originalStart");
    return { family, native };
  };
  const matches = (value: Awaited<ReturnType<typeof read>>) => value.family && graphOccurrenceContentObserved(saved, value.family) &&
    matchesMeetingContent(baseline, patch, value.native, saved.identity.selfAddress, saved.context.masterID) &&
    value.family.instances.find(n => n.externalID === saved.targetID)?.etag === microsoftMeetingContentEvidence(value.native, saved.identity.selfAddress, saved.context.masterID).etag;
  if (saved.dispatch) {
    const after = await read().catch(() => null);
    if (!saved.dispatch.acceptedAt || !after || !matches(after)) return unknown();
    return { kind: "observed" as const, observation: after.family! };
  }
  const current = await read();
  if (!same(current.family, saved.baseline) || !same(microsoftMeetingContentEvidence(current.native, saved.identity.selfAddress, saved.context.masterID), baseline)) fail();
  if (matches(current)) return { kind: "observed" as const, observation: current.family! };
  await mark();
  try {
    const response = await fetch(transport.path(saved.targetID), { method: "PATCH", headers: { ...transport.headers, "Content-Type": "application/json", "If-Match": baseline.etag }, body: JSON.stringify(patch), signal, redirect: "error" });
    if (response.status === 412) return { kind: "rejected" as const };
    if (response.status !== 200) return unknown();
    // Graph omits originalStart from ordinary PATCH responses. Identity here
    // acknowledges acceptance; the selected full GET below proves the result.
    const native = await response.json();
    if (native?.id !== baseline.id || native.iCalUId !== baseline.iCalUId || native.seriesMasterId !== saved.context.masterID || !["occurrence", "exception"].includes(native.type)) return unknown();
    await accepted();
    const after = await read();
    if (!matches(after)) return unknown();
    return { kind: "observed" as const, observation: after.family! };
  } catch { return unknown(); }
}
