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
  const evidence = await googleAdapter.readRsvp!(actorID, context.accountID, context.externalCalendarID, { externalEventId: context.externalEventID, etag: context.etag }, context.request.response, AbortSignal.timeout(10_000), context.instance ? { externalSeriesID: context.instance.externalSeriesID, originalStart: context.instance.originalStart } : undefined);
  const native = googleRsvpEventEvidence(evidence);
  if (!matchesRsvpEventProjection("google", context.event, native, context.instance) || !isDeepStrictEqual(context.state, googleEventState(evidence.baseline)))
    throw new BadRequestError("Provider meeting changed. Sync and reopen before responding.");
  return commitProviderRsvpEdit(context, evidence.baseline, native.timeModel!);
}
