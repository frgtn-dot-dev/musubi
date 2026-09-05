import { EventWriteError } from "@musubi/types";

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
