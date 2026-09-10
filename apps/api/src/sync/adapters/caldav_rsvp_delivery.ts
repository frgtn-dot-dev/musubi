import { isDeepStrictEqual } from "node:util";
import { config } from "@musubi/config";
import { EventWriteError } from "@musubi/types";
import { createGuardedCaldavFetch } from "../caldav_client";
import { readCaldavSchedulingProof } from "../caldav_scheduling";
import { assertEventWriteResponse, assertProviderEventMutationResponse, requireEventEtag, ProviderEventWriteError } from "../event_write";
import { caldavSeriesResourceURL, sameCaldavResource } from "./caldav_series";
import { prepareCaldavRsvp, caldavRsvpResourceHash, type CaldavRsvpEvidence } from "./caldav_rsvp";
const fetch = createGuardedCaldavFetch();
function enabled() { if (!config.api.providerRsvpEditsEnabled) throw new EventWriteError("event-write", "unsupported"); }
export async function readCaldavRsvpResource(id: string, authorization: string, signal?: AbortSignal) {
  const response = await fetch(id, { redirect: "error", signal, headers: { authorization, accept: "text/calendar", "cache-control": "no-cache" } });
  assertEventWriteResponse(response);
  if (response.status !== 200 || response.headers.has("content-range")) throw new ProviderEventWriteError("provider-write-failed");
  return { data: new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer()), etag: requireEventEtag(response.headers.get("etag")), scheduleTag: requireEventEtag(response.headers.get("schedule-tag")) };
}
export async function readCaldavRsvp(collection: string, ref: { id: string; etag: string; uid: string }, authorization: string, response: CaldavRsvpEvidence["response"], signal?: AbortSignal): Promise<CaldavRsvpEvidence> {
  enabled(); caldavSeriesResourceURL(collection, ref.id);
  const proof = await readCaldavSchedulingProof(collection, ref.id, authorization, signal);
  const current = await readCaldavRsvpResource(ref.id, authorization, signal);
  if (current.etag !== ref.etag) throw new ProviderEventWriteError("provider-conflict");
  return prepareCaldavRsvp(current.data, { ...ref, scheduleTag: current.scheduleTag }, proof, response);
}
export async function deliverCaldavRsvp(collection: string, saved: CaldavRsvpEvidence, authorization: string, signal?: AbortSignal, beforeWrite?: () => Promise<void>, readOnly = false) {
  enabled();
  // Reconstruct all private bytes/hashes after JSON persistence; caller input
  // cannot widen an RSVP into an unrelated content or attendee edit.
  const evidence = prepareCaldavRsvp(saved.before, saved, saved.proof, saved.response);
  if (!isDeepStrictEqual(evidence, saved)) throw new ProviderEventWriteError("provider-conflict");
  caldavSeriesResourceURL(collection, evidence.id);
  const proof = await readCaldavSchedulingProof(collection, evidence.id, authorization, signal);
  if (!isDeepStrictEqual(proof, evidence.proof)) throw new ProviderEventWriteError("provider-conflict");
  const result = (current: Awaited<ReturnType<typeof readCaldavRsvpResource>>, recovered: boolean) => {
    const observed = prepareCaldavRsvp(current.data, { id: evidence.id, etag: current.etag, uid: evidence.uid, scheduleTag: current.scheduleTag }, proof, evidence.response);
    if (observed.before !== observed.after || observed.selfAddress !== evidence.selfAddress || caldavRsvpResourceHash(current.data) !== evidence.desiredResourceHash) throw new ProviderEventWriteError("provider-conflict", "unconfirmed");
    return { etag: current.etag, recovered, notificationDelivery: "unknown" as const, confirmation: { resourceHash: evidence.desiredResourceHash, scheduleTag: current.scheduleTag, selfAddress: evidence.selfAddress } };
  };
  let current: Awaited<ReturnType<typeof readCaldavRsvpResource>>;
  try {
    current = await readCaldavRsvpResource(evidence.id, authorization, signal);
    if (caldavRsvpResourceHash(current.data) === evidence.desiredResourceHash) return result(current, true);
  } catch (error) {
    if (!readOnly) throw error;
    throw new ProviderEventWriteError("caldav-rsvp-response-unconfirmed", "unconfirmed", error instanceof ProviderEventWriteError ? error.providerStatus : undefined, error instanceof ProviderEventWriteError ? error.retryAfterMs : undefined);
  }
  // A previous dispatch may have reached the provider even when its resource
  // still reads as the baseline. Only a complete desired readback can settle it.
  if (readOnly) throw new ProviderEventWriteError("caldav-rsvp-response-unconfirmed", "unconfirmed");
  if (current.etag !== evidence.etag || current.scheduleTag !== evidence.scheduleTag || !sameCaldavResource(current.data, evidence.before)) throw new ProviderEventWriteError("provider-conflict");
  await beforeWrite?.(); signal?.throwIfAborted(); enabled();
  let accepted = false;
  try {
    const response = await fetch(evidence.id, { method: "PUT", redirect: "error", signal, headers: { authorization, "content-type": "text/calendar; charset=utf-8", "if-match": evidence.etag }, body: evidence.after });
    assertProviderEventMutationResponse(response); accepted = true;
    return result(await readCaldavRsvpResource(evidence.id, authorization, signal), false);
  } catch (error) {
    if (!accepted && error instanceof ProviderEventWriteError && error.providerStatus !== undefined) throw error;
    throw new ProviderEventWriteError("provider-write-failed", "unconfirmed", error instanceof ProviderEventWriteError ? error.providerStatus : undefined);
  }
}
