import { isDeepStrictEqual } from "node:util";
import { config } from "@musubi/config";
import { BadRequestError, EventWriteError } from "@musubi/types";
import { getEventSnapshot, queueProviderReminderEdit, prepareProviderReminderInstanceEdit, commitProviderReminderInstanceEdit, matchesRsvpEventProjection } from "@musubi/db";
import { googleAdapter } from "./adapters/google";
import { googleReminderInstanceProjection } from "./adapters/google_reminder_instance";
import { googleEventState } from "./adapters/provider_event_state";

/** HTTP admission only: native read outside the transaction, never inline PATCH. */
export async function queueGoogleReminders(actorID: string, eventID: string, input: unknown) {
  if (!config.api.providerReminderEditsEnabled) throw new EventWriteError("event-write", "unsupported");
  // This internal shape lookup selects the contract; each queue independently
  // establishes the actor's current source permission under its own locks.
  const event = await getEventSnapshot(eventID);
  if (!event?.seriesID && !event?.originalStart) return queueProviderReminderEdit(actorID, eventID, input);
  const prepared = await prepareProviderReminderInstanceEdit(actorID, eventID, input);
  if (prepared.kind === "replay") return prepared.receipt;
  const context = prepared.context;
  const evidence = await googleAdapter.reminderInstance!.read(actorID, context.accountID, context.externalCalendarID,
    { eventID: context.externalEventID, etag: context.etag, occurrence: { externalSeriesID: context.instance.externalSeriesID, originalStart: context.instance.originalStart } }, context.request.reminders, AbortSignal.timeout(10_000));
  const native = googleReminderInstanceProjection(evidence);
  if (!matchesRsvpEventProjection("google", context.event, native, context.instance) || !isDeepStrictEqual(context.state, googleEventState(evidence.baseline)))
    throw new BadRequestError("Provider event changed. Sync and reopen before changing reminders.");
  return commitProviderReminderInstanceEdit(context, evidence.baseline, native.timeModel!);
}
