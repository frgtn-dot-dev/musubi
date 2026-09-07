import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { requireUUID } from "../request_validation";

/** Optional transport identity for an explicit retry. Legacy requests still get
 * unique operation IDs; PATCH/DELETE retain their existing revision CAS guard. */
export function eventMutationIdentity(req: Request) {
  const supplied = req.get("Idempotency-Key");
  return {
    actorID: req.user!.id,
    mutationID:
      supplied === undefined
        ? randomUUID()
        : requireUUID(supplied, "Idempotency-Key"),
  };
}
