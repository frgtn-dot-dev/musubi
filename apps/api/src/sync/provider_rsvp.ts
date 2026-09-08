import { isDeepStrictEqual } from "node:util";
import { config } from "@musubi/config";
import { BadRequestError, EventWriteError } from "@musubi/types";
import { prepareProviderRsvpEdit, commitProviderRsvpEdit, matchesReminderEventProjection } from "@musubi/db";
import { googleAdapter, googleReminderEventEvidence } from "./adapters/google";
import { googleEventState } from "./adapters/provider_event_state";

/** Prepare a durable intent without sending the RSVP in the HTTP request. Never call provider
 * mutation inside a DB transaction or replace a stale prepared baseline. */
export async function queueGoogleRsvp(actorID: string, eventID: string, input: unknown) {
  if (!config.api.providerRsvpEditsEnabled) throw new EventWriteError("event-write", "unsupported");
  const prepared = await prepareProviderRsvpEdit(actorID, eventID, input);
  if (prepared.kind === "replay") return prepared.receipt;
  const context = prepared.context;
  const evidence = await googleAdapter.readRsvp!(actorID, context.accountID, context.externalCalendarID, { externalEventId: context.externalEventID, etag: context.etag }, context.request.response);
  const native = googleReminderEventEvidence(evidence.baseline);
  if (!matchesReminderEventProjection("google", context.event, native) || !isDeepStrictEqual(context.state, googleEventState(evidence.baseline)))
    throw new BadRequestError("Provider meeting changed. Sync and reopen before responding.");
  return commitProviderRsvpEdit(context, evidence.baseline, native.timeModel!);
}
