import { randomUUID } from "node:crypto";
import { planEventScope } from "@musubi/calendar";
import {
  type GoogleOccurrenceContext,
  type GoogleOccurrencePrepared,
} from "@musubi/db";
import { EventScopeRequestSchema, type Event } from "@musubi/types";
import { googleAdapter } from "./adapters/google";
import { matchesGoogleOccurrence } from "./adapters/google_occurrence";
import { ProviderEventWriteError } from "./event_write";

export async function prepareGoogleOccurrence(
  context: GoogleOccurrenceContext,
  input: unknown,
): Promise<GoogleOccurrencePrepared> {
  const request = EventScopeRequestSchema.parse(input);
  if (request.scope !== "occurrence" || !request.originalStart)
    throw new ProviderEventWriteError("provider-conflict");
  const baselinePlan = planEventScope(
    context.master,
    context.children,
    {
      ...request,
      action: "update",
      patch: {},
      time: undefined,
      ensureDefinition: true,
    },
    randomUUID,
  );
  const baseline =
    context.children.find(
      (child) =>
        JSON.stringify(child.originalStart) ===
        JSON.stringify(request.originalStart),
    ) ?? baselinePlan.creates[0];
  if (!baseline) throw new ProviderEventWriteError("provider-conflict");
  const observed = await googleAdapter.readOccurrence!(
    context.link.userID,
    context.link.accountID,
    context.link.externalCalendarID,
    {
      master: context.master,
      masterExternalID: context.mapping.externalEventID,
      masterEtag: context.mapping.etag!,
      originalStart: request.originalStart,
      baseline: baseline as Event,
    },
    undefined,
    AbortSignal.timeout(10_000),
  );
  if (!matchesGoogleOccurrence(baseline, observed.event))
    throw new ProviderEventWriteError("provider-conflict");
  return {
    context,
    externalEventID: observed.ref.externalEventId,
    etag: observed.ref.etag!,
    baseline,
    providerState: observed.state,
    masterProof: observed.masterProof,
  };
}
