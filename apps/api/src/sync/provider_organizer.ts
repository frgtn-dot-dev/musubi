import { caldavAdapter } from "./adapters/caldav";
import {
  caldavOrganizerDesired,
  caldavOrganizerNative,
} from "./adapters/caldav_organizer";
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
  if (link.provider === "caldav") {
    const transport = await caldavAdapter.caldavOrganizer!(
      actorID,
      link.accountID,
      link.externalCalendarID,
      "create",
      undefined,
      AbortSignal.timeout(10_000),
    );
    if (transport.proof.addresses.length !== 1)
      throw new EventWriteError("organizer", "unsupported");
    return {
      provider: "caldav" as const,
      calendarID,
      notificationPolicy: "server-invite" as const,
      createTime: "utc-or-all-day" as const,
    };
  }
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
  const parsed = ProviderOrganizerRequestSchema.safeParse(input);
  if (!parsed.success)
    throw new OrganizerAdmissionRejectedError(
      "Check the meeting fields and use a positive duration.",
    );
  const prepared = await prepareProviderOrganizer(actorID, parsed.data);
  if (prepared.kind === "saved") return prepared.receipt;
  const context = prepared.context;
  if (context.request.provider === "caldav") {
    const transport = await caldavAdapter.caldavOrganizer!(
      actorID,
      context.link.accountID,
      context.link.externalCalendarID,
      context.request.action,
      context.mapping?.externalEventID,
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
          "caldav",
          context.event!,
          caldavOrganizerNative(baseline).projection,
        ))
    )
      throw new BadRequestError(
        "The provider meeting changed. Sync and reopen.",
      );
    let desired;
    try {
      desired = caldavOrganizerDesired(
        context.link.externalCalendarID,
        context.request,
        baseline,
        transport.proof,
        new Date()
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}Z$/, "Z"),
      );
    } catch (error) {
      if (error instanceof EventWriteError)
        throw new OrganizerAdmissionRejectedError(
          "Check the guests and meeting time. CalDAV creation requires explicit UTC or all-day time and external guests.",
        );
      throw error;
    }
    const saved = await prepareProviderOrganizer(actorID, context.request, {
      context,
      baseline,
      desired,
    });
    if (saved.kind !== "saved")
      throw new Error("Organizer intent was not committed");
    return saved.receipt;
  }
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
    !(observation.state?.provider === "caldav"
      ? config.api.caldavOrganizerEditsEnabled
      : observation.state?.provider === "google" &&
        config.api.providerOrganizerEditsEnabled &&
        observation.state.isOrganizer === true) ||
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
      ...(observation.state!.provider === "caldav"
        ? { provider: "caldav", notificationPolicy: "server-invite" }
        : { provider: "google", sendUpdates: "all" }),
      action: "delete",
      expectedRevision: event.revision,
      expectedStateVersion: observation.version,
    });
    if (prepared.kind !== "prepared") return observation;
    const ctx = prepared.context;
    if (ctx.request.provider === "caldav") {
      const actions: ("update" | "delete")[] = [];
      for (const action of ["update", "delete"] as const) {
        try {
          const transport = await caldavAdapter.caldavOrganizer!(
            actorID,
            ctx.link.accountID,
            ctx.link.externalCalendarID,
            action,
            ctx.mapping!.externalEventID,
            AbortSignal.timeout(10_000),
          );
          const native = await transport.read(ctx.mapping!.externalEventID);
          if (
            native &&
            native.etag === ctx.mapping!.etag &&
            matchesRsvpEventProjection(
              "caldav",
              ctx.event!,
              caldavOrganizerNative(native).projection,
            )
          )
            actions.push(action);
        } catch {
          /* Each action needs its own current positive DAV proof. */
        }
      }
      if (!actions.length) return observation;
      return {
        ...observation,
        organizerEdit: {
          provider: "caldav" as const,
          calendarID: ctx.request.calendarID,
          expectedRevision: event.revision,
          actions,
        },
      };
    }

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
