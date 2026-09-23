import { verifiedGraphIdentity } from "./microsoft_identity";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { config } from "@musubi/config";
import { EventWriteError, type GraphRsvpOccurrence, type ProviderRsvpEdit } from "@musubi/types";
import { assertCompleteEventReadResponse } from "../event_create_identity";
import { ProviderEventWriteError } from "../event_write";
import { microsoftRsvpEvidence, matchesMicrosoftRsvp, type MicrosoftRsvpEvidence } from "./microsoft_rsvp";
const base = "https://graph.microsoft.com/v1.0";
const id = z.string().min(1).refine(value => value.trim() === value && value !== "." && value !== "..");
const fail = (): never => { throw new ProviderEventWriteError("provider-conflict"); };
export async function graphRsvpSession(token: string, accountID: string, calendarID: string, signal?: AbortSignal) {
  if (!config.api.providerRsvpEditsEnabled) throw new EventWriteError("event-write", "unsupported");
  id.parse(accountID); id.parse(calendarID);
  const headers = { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"', "Cache-Control": "no-cache" };
  const get = async (url: string, missing = false) => {
    const response = await fetch(url, { headers, redirect: "error", signal });
    if (missing && response.status === 404) return null;
    assertCompleteEventReadResponse(response); return response.json();
  };
  const identity = await verifiedGraphIdentity(get, accountID, calendarID);
  const selfAddress = identity.selfAddress;
  const url = (eventID: string) => `${base}/me/calendars/${encodeURIComponent(calendarID)}/events/${encodeURIComponent(id.parse(eventID))}`;
  const targetURL = (eventID: string, occurrence?: GraphRsvpOccurrence) => url(eventID) + (occurrence ? "?$select=*,originalStart" : "");
  const read = async (eventID: string, response: ProviderRsvpEdit["response"], occurrence?: GraphRsvpOccurrence) => {
    const native = await get(targetURL(eventID, occurrence), true);
    if (!native) return null;
    const master = occurrence ? await get(url(occurrence.externalSeriesID)) : undefined;
    const evidence = microsoftRsvpEvidence(native, selfAddress, response, identity, occurrence, master);
    if (evidence.id !== eventID) fail();
    return evidence;
  };
  return {
    read,
    write: async (saved: MicrosoftRsvpEvidence, dispatched: boolean, beforeDispatch: () => Promise<void>, accepted: () => Promise<void>) => {
      saved = structuredClone(saved);
      if (!isDeepStrictEqual(saved.graphIdentity, identity) || saved.selfAddress !== selfAddress) fail();
      const current = await read(saved.id, saved.response, saved.occurrence);
      if (!current) return { kind: "absent" as const };
      if (matchesMicrosoftRsvp(saved, current.native, current.master)) return { kind: "observed" as const, evidence: current };
      if (dispatched) return { kind: "unconfirmed" as const };
      if (!isDeepStrictEqual(current, saved)) fail();
      await beforeDispatch();
      // The durable marker is committed before this call. Even a definite HTTP
      // failure cannot remove it or grant permission to repeat the action.
      const action = saved.response === "accepted" ? "accept" : saved.response === "tentative" ? "tentativelyAccept" : "decline";
      const response = await fetch(`${url(saved.id)}/${action}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ sendResponse: true }), redirect: "error", signal });
      if (response.status !== 202) throw new ProviderEventWriteError("provider-write-failed", "unconfirmed", response.status);
      await accepted();
      const result = await read(saved.id, saved.response, saved.occurrence);
      if (!result) return { kind: "absent" as const };
      return matchesMicrosoftRsvp(saved, result.native, result.master) ? { kind: "observed" as const, evidence: result } : { kind: "unconfirmed" as const };
    },
  };
}
