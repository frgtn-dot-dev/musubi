import ICAL from "ical.js";
import { config } from "@musubi/config";
import { createGuardedCaldavFetch } from "../caldav_client";
import { readIcloudOrganizerCreateEvidence, type CaldavSchedulingProof } from "../caldav_scheduling";
import { assertEventWriteResponse, requireEventEtag, ProviderEventWriteError } from "../event_write";
import { observeIcloudOrganizerCreate, type CaldavOrganizerDesired } from "./caldav_organizer";
const fetch = createGuardedCaldavFetch();
/** No provider mutation: recover only a fully verified created object. */
export async function readIcloudOrganizerCreation(target: string, desired: CaldavOrganizerDesired, proof: CaldavSchedulingProof, authorization: string, eligible: () => Promise<boolean>, signal?: AbortSignal) {
  const allowed = async () => config.api.caldavOrganizerEditsEnabled && config.api.icloudOrganizerCreateEnabled && await eligible();
  if (!await allowed()) throw new ProviderEventWriteError("provider-version-unavailable");
  const read = async () => {
    const response = await fetch(target, { redirect: "error", signal, headers: { authorization, accept: "text/calendar", "cache-control": "no-cache" } });
    assertEventWriteResponse(response);
    if (response.status !== 200 || response.headers.has("content-range") || response.headers.has("schedule-tag")) throw new ProviderEventWriteError("provider-conflict", "unconfirmed");
    return { etag: requireEventEtag(response.headers.get("etag")), data: new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer()) };
  };
  const before = await read();
  const uris = await readIcloudOrganizerCreateEvidence(target, proof, authorization, signal);
  const after = await read();
  if (before.etag !== after.etag || before.data !== after.data || !await allowed()) throw new ProviderEventWriteError("provider-conflict", "unconfirmed");
  const uid = new ICAL.Component(ICAL.parse(after.data)).getFirstSubcomponent("vevent")?.getFirstPropertyValue("uid");
  if (typeof uid !== "string") throw new ProviderEventWriteError("provider-conflict", "unconfirmed");
  return observeIcloudOrganizerCreate({ id: target, ...after, iCalUID: uid, proof }, desired, uris);
}
