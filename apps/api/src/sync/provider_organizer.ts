import { randomUUID } from "node:crypto";
import { config } from "@musubi/config";
import {
  prepareProviderOrganizer,
  readProviderOrganizerCalendar,
  matchesRsvpEventProjection,
} from "@musubi/db";
import {
  BadRequestError,
  OrganizerAdmissionRejectedError,
  ProviderOrganizerRequestSchema,
  EventWriteError,
  type ProviderEventStateResponse,
} from "@musubi/types";
import { googleAdapter, googleReminderEventEvidence } from "./adapters/google";
import { googleOrganizerBody } from "./adapters/google_organizer";
export async function observeOrganizerCalendar(
  actorID: string,
  calendarID: string,
) {
  const link = await readProviderOrganizerCalendar(actorID, calendarID);
  await googleAdapter.organizer!(
    actorID,
    link.accountID,
    link.externalCalendarID,
    AbortSignal.timeout(10_000),
  );
  return {
    provider: "google" as const,
    calendarID,
    sendUpdates: "all" as const,
  };
}
export async function queueProviderOrganizer(actorID: string, input: unknown) {
  if (!config.api.providerOrganizerEditsEnabled)
    throw new EventWriteError("organizer", "unsupported");
  const parsed = ProviderOrganizerRequestSchema.safeParse(input);
  if (!parsed.success)
    throw new OrganizerAdmissionRejectedError(
      "Check the meeting fields and use a positive duration.",
    );
  const prepared = await prepareProviderOrganizer(actorID, parsed.data);
  if (prepared.kind === "saved") return prepared.receipt;
  const context = prepared.context;
  const transport = await googleAdapter.organizer!(
    actorID,
    context.link.accountID,
    context.link.externalCalendarID,
    AbortSignal.timeout(10_000),
  );
  const baseline = context.mapping
    ? await transport.read(context.mapping.externalEventID)
    : null;
  if (
    context.mapping &&
    (!baseline ||
      baseline.etag !== context.mapping.etag ||
      !matchesRsvpEventProjection(
        "google",
        context.event!,
        googleReminderEventEvidence(baseline),
      ))
  )
    throw new BadRequestError("The provider meeting changed. Sync and reopen.");
  let desired;
  try {
    desired = googleOrganizerBody(context.request, baseline, transport.email);
  } catch (error) {
    if (error instanceof EventWriteError)
      throw new OrganizerAdmissionRejectedError(
        "Check the guests and meeting time. Guests must exclude the organizer and timed meetings need a positive duration.",
      );
    throw error;
  }
  const result = await prepareProviderOrganizer(actorID, context.request, {
    context,
    baseline,
    desired,
  });
  if (result.kind !== "saved")
    throw new Error("Organizer intent was not committed");
  return result.receipt;
}
export async function observeProviderOrganizer(
  actorID: string,
  eventID: string,
  observation: ProviderEventStateResponse,
) {
  if (
    !config.api.providerOrganizerEditsEnabled ||
    observation.state?.provider !== "google" ||
    observation.state.isOrganizer !== true ||
    !observation.version
  )
    return observation;
  try {
    const { getEventSnapshot } = await import("@musubi/db");
    const event = await getEventSnapshot(eventID);
    if (!event?.originCalendarID || !event.revision) return observation;
    const prepared = await prepareProviderOrganizer(actorID, {
      operationID: randomUUID(),
      eventID,
      calendarID: event.originCalendarID,
      provider: "google",
      sendUpdates: "all",
      action: "delete",
      expectedRevision: event.revision,
      expectedStateVersion: observation.version,
    });
    if (prepared.kind !== "prepared") return observation;
    const ctx = prepared.context;
    const transport = await googleAdapter.organizer!(
      actorID,
      ctx.link.accountID,
      ctx.link.externalCalendarID,
      AbortSignal.timeout(10_000),
    );
    const native = await transport.read(ctx.mapping!.externalEventID);
    if (
      !native ||
      native.etag !== ctx.mapping!.etag ||
      !matchesRsvpEventProjection(
        "google",
        ctx.event!,
        googleReminderEventEvidence(native),
      )
    )
      return observation;
    return {
      ...observation,
      organizerEdit: {
        provider: "google" as const,
        calendarID: ctx.request.calendarID,
        expectedRevision: event.revision,
      },
    };
  } catch {
    return observation;
  }
}
