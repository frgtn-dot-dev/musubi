import { EventWriteError } from "@musubi/types";
import { getOAuthCredentials, hasProviderSyncScopes, type EventContentPatch } from "@musubi/db";

export type ProviderEventWriteCode = "provider-conflict" | "provider-version-unavailable" | "event-diff-unavailable" | "provider-write-failed";

/** Provider outcome only: this does NOT say whether the local transaction committed. */
export class ProviderEventWriteError extends Error {
  constructor(
    readonly code: ProviderEventWriteCode,
    readonly outcome: "not-written" | "unconfirmed" = "not-written",
    readonly providerStatus?: number,
  ) {
    super(`Event delivery: ${code}.`);
    this.name = "ProviderEventWriteError";
  }
}

/** RFC 9110 entity-tag, strong comparison only. Do not trim, quote or repair. */
export function strongEventEtag(value: unknown): string | null {
  return typeof value === "string" && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value) ? value : null;
}

export function requireEventEtag(value: unknown): string {
  const etag = strongEventEtag(value);
  if (etag === null) throw new ProviderEventWriteError("provider-version-unavailable");
  return etag;
}

export function assertAcceptedEventEtag(accepted: unknown, current: unknown) {
  if (requireEventEtag(accepted) !== requireEventEtag(current)) {
    throw new ProviderEventWriteError("provider-conflict");
  }
}

export function requireEventPatch(patch: EventContentPatch | undefined): EventContentPatch {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new ProviderEventWriteError("event-diff-unavailable");
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as EventContentPatch;
}

/** A 412 is never retried unconditionally. Other failed writes may be ambiguous. */
export function assertProviderEventMutationResponse(response: Response) {
  if ([200, 201, 204].includes(response.status)) return;
  throw new ProviderEventWriteError(
    response.status === 412 ? "provider-conflict" : "provider-write-failed",
    response.ok || response.status >= 500 ? "unconfirmed" : "not-written",
    response.status,
  );
}

/** Read AFTER token refresh: an ACL grant cannot replace the OAuth write grant. */
export async function assertOAuthEventWriteGrant(userID: string, provider: string, accountID: string) {
  const credentials = await getOAuthCredentials(userID, provider, accountID);
  assertEventWriteEvidence(
    credentials?.scope == null ? undefined : hasProviderSyncScopes(provider, credentials.scope),
    "event-write",
  );
}

/** Missing provider evidence is distinct from an explicit refusal. Never infer a grant. */
export function assertEventWriteEvidence(
  allowed: boolean | undefined,
  capability: "event-write" | "organizer",
) {
  if (allowed !== true) {
    throw new EventWriteError(
      capability,
      allowed === false ? "denied" : "unknown",
    );
  }
}

export function assertEventWriteResponse(response: Response) {
  if (!response.ok) {
    throw new EventWriteError(
      "event-write",
      response.status === 401 || response.status === 403 ? "denied" : "unknown",
    );
  }
}

export function canonicalEventRecurrence(value: string | null | undefined) {
  return value
    ? [...new Set(value.split("\n").filter(Boolean))].sort().join("\n")
    : null;
}
