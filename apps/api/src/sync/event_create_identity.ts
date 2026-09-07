import type { EventCreateIdentity, NormalizedEvent } from "./adapter";
import {
  assertEventWriteResponse,
  ProviderEventWriteError,
} from "./event_write";

export function assertCompleteEventReadResponse(response: Response) {
  assertEventWriteResponse(response);
  if (response.status !== 200 || response.headers.has("content-range"))
    throw new ProviderEventWriteError("provider-write-failed");
}

export function eventCreateOperationID(identity: EventCreateIdentity): string {
  const id = identity.operationID;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new ProviderEventWriteError("provider-write-failed");
  return id.toLowerCase();
}

// Hex UUIDs are a subset of Google's base32hex alphabet. Identity is scoped to
// the persisted target operation, so unlink/relink creates a distinct object.
export function googleEventCreateID(identity: EventCreateIdentity) {
  return `musubi${eventCreateOperationID(identity).replace(/-/g, "")}`;
}

export function caldavEventCreateIdentity(
  calendarURL: string,
  identity: EventCreateIdentity,
) {
  const uid = `musubi-${eventCreateOperationID(identity)}`;
  const base = calendarURL.endsWith("/") ? calendarURL : `${calendarURL}/`;
  return { uid, url: `${base}${uid}.ics` };
}

/** A cancelled object or malformed projection is not successful recovery. */
export function assertCreatedEventEvidence(event: NormalizedEvent) {
  if (event.status !== "active")
    throw new ProviderEventWriteError("provider-conflict");
  if (
    !event.externalId ||
    !Number.isFinite(event.start.getTime()) ||
    !Number.isFinite(event.end.getTime())
  )
    throw new ProviderEventWriteError("provider-write-failed");
  return event;
}
