import { findGraphOccurrenceContent, saveGraphOccurrenceContent } from "@musubi/db";
import { MicrosoftRecurringContentRequestSchema, MicrosoftOccurrenceContentRequestSchema } from "@musubi/types";
import { readGraphMeetingContext, findGraphMeetingCancellation, saveGraphMeetingCancellation } from "@musubi/db";
import { MicrosoftSeriesCancellationRequestSchema } from "@musubi/types";
import { caldavOrganizerTimeEvidence } from "./adapters/caldav_organizer_time";
import { microsoftAdapter } from "./adapters/microsoft";
import { microsoftOrganizerBody, microsoftMeetingContentBody, microsoftMeetingContentProjection } from "./adapters/microsoft_organizer";
import { caldavAdapter } from "./adapters/caldav";
import {
  caldavOrganizerDesired,
  caldavOrganizerNative,
} from "./adapters/caldav_organizer";
import { randomUUID } from "node:crypto";
import { config } from "@musubi/config";
import {
  readProviderOrganizerInstanceVersion,
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
  if (link.provider === "microsoft") {
    await microsoftAdapter.microsoftOrganizer!(actorID, link.accountID, link.externalCalendarID, AbortSignal.timeout(10_000));
    return { provider: "microsoft" as const, calendarID, notificationPolicy: "server-invite" as const, createTime: "utc-or-all-day" as const, actions: ["create"] as ["create"] };
  }
  if (link.provider === "caldav") {
    const transport = await caldavAdapter.caldavOrganizer!(
      actorID,
      link.accountID,
      link.externalCalendarID,
      "create",
      undefined,
      AbortSignal.timeout(10_000),
    );
    return {
      provider: "caldav" as const,
      ...(transport.proof.addresses.length > 1 ? { organizerAddresses: transport.proof.addresses } : {}),
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
  if (parsed.data.provider === "microsoft" && parsed.data.action === "update" && parsed.data.scope === "series") {
    const request = MicrosoftRecurringContentRequestSchema.parse(parsed.data);
    const replay = await findGraphOccurrenceContent(actorID, request);
    if (replay) return replay;
    const context = await readGraphMeetingContext({ actorID, calendarID: request.calendarID, eventID: request.eventID });
    return saveGraphOccurrenceContent(await microsoftAdapter.prepareGraphSeriesContent!(context, request, AbortSignal.timeout(20_000)));
  }
  if (parsed.data.provider === "microsoft" && parsed.data.action === "update" && parsed.data.scope === "occurrence") {
    const request = MicrosoftOccurrenceContentRequestSchema.parse(parsed.data);
    const replay = await findGraphOccurrenceContent(actorID, request);
    if (replay) return replay;
    const context = await readGraphMeetingContext({ actorID, calendarID: request.calendarID, eventID: request.eventID });
    return saveGraphOccurrenceContent(await microsoftAdapter.prepareGraphOccurrenceContent!(context, request, AbortSignal.timeout(20_000)));
  }
  if (parsed.data.provider === "microsoft" && parsed.data.action === "delete" && (parsed.data.scope || parsed.data.expectedSeriesVersion)) {
    const request = MicrosoftSeriesCancellationRequestSchema.parse(parsed.data);
    const replay = await findGraphMeetingCancellation(actorID, request);
    if (replay) return replay;
    const context = await readGraphMeetingContext({ actorID, calendarID: request.calendarID, eventID: request.eventID });
    return saveGraphMeetingCancellation(await microsoftAdapter.prepareGraphMeetingCancellation!(context, request, AbortSignal.timeout(20_000)));
  }
  const prepared = await prepareProviderOrganizer(actorID, parsed.data);
  if (prepared.kind === "saved") return prepared.receipt;
  const context = prepared.context;
  if (context.request.provider === "microsoft") {
    const transport = await microsoftAdapter.microsoftOrganizer!(actorID, context.link.accountID, context.link.externalCalendarID, AbortSignal.timeout(10_000));
    const baseline = context.mapping ? await transport.read(context.mapping.externalEventID, context.request.action === "update") : null;
    if (context.mapping && (!baseline || baseline.etag !== context.mapping.etag || context.request.action === "update" && !matchesRsvpEventProjection("microsoft", context.event!, microsoftMeetingContentProjection(baseline, transport.email))))
      throw new BadRequestError("The provider meeting changed. Sync and reopen.");
    let desired;
    try { desired = context.request.action === "delete" ? null : context.request.action === "update" ? microsoftMeetingContentBody(context.request) : microsoftOrganizerBody(context.request, transport.email); }
    catch { throw new OrganizerAdmissionRejectedError(context.request.action === "update" ? "Choose a title, notes or location change for this Outlook meeting." : "Choose external guests and explicit UTC or all-day time."); }
    const saved = await prepareProviderOrganizer(actorID, context.request, { context, baseline, desired, graphIdentity: transport.identity });
    if (saved.kind !== "saved") throw new Error("Organizer intent was not committed");
    return saved.receipt;
  }
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
          "Check the guests and meeting time. Create in UTC or all-day dates; reschedule within the existing type and zone using unambiguous times.",
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
    ? await transport.read(context.mapping.externalEventID, context.instance)
    : null;
  if (
    context.mapping &&
    (!baseline ||
      baseline.etag !== context.mapping.etag ||
      !matchesRsvpEventProjection(
        "google",
        context.event!,
        organizerProjection(baseline, context.instance),
        context.instance,
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
  outlookOrganizer: boolean | "series" | "content" | "series-content" = false,
) {
  // Older clients strictly parse the provider enum. Only advertise the new
  // capability to clients that explicitly opt into this additive read.
  if (observation.state?.provider === "microsoft" && !outlookOrganizer) return observation;
  if (
    !(observation.state?.provider === "caldav"
      ? config.api.caldavOrganizerEditsEnabled
      : ["google", "microsoft"].includes(observation.state?.provider ?? "") &&
        config.api.providerOrganizerEditsEnabled &&
        observation.state?.isOrganizer === true) ||
    !observation.version
  )
    return observation;
  try {
    const { getEventSnapshot } = await import("@musubi/db");
    const event = await getEventSnapshot(eventID);
    if (!event?.originCalendarID || !event.revision) return observation;
    if (observation.state?.provider === "microsoft" && outlookOrganizer === "series-content") {
      // v4 is additive; never send new strict fields to v1–v3 clients.
      outlookOrganizer = "content";
      try {
        const context = await readGraphMeetingContext({ actorID, eventID, calendarID: event.originCalendarID });
        const native = await microsoftAdapter.observeGraphSeriesContent!(context, AbortSignal.timeout(20_000));
        const { title, description, location } = native.baseline.master.values;
        observation = { ...observation, outlookSeriesContent: { calendarID: event.originCalendarID, expectedRevision: event.revision, seriesVersion: native.version, content: { title, description, location } } };
      } catch { /* Individual occurrence editing can still qualify. */ }
    }
    if (observation.state?.provider === "microsoft" && outlookOrganizer === "content") {
      try {
        const context = await readGraphMeetingContext({ actorID, eventID, calendarID: event.originCalendarID });
        const native = await microsoftAdapter.observeGraphOccurrenceContent!(context, AbortSignal.timeout(20_000));
        // v3 alone advertises the new occurrence proof. Older strict readers keep v2.
        const cancellation = native.baseline.master.providerState.attendees.length ? await microsoftAdapter.observeGraphMeetingCancellation!(context, AbortSignal.timeout(20_000)).catch(() => undefined) : undefined;
        return { ...observation,
          ...(cancellation ? { outlookCancellation: { calendarID: event.originCalendarID, expectedRevision: event.revision, seriesVersion: cancellation.version, scopes: cancellation.scopes } } : {}),
          organizerEdit: { provider: "microsoft" as const, scope: "occurrence" as const, seriesVersion: native.version, calendarID: event.originCalendarID, expectedRevision: event.revision, actions: ["update" as const] },
        };
      } catch { /* Cancellation or one-off content editing can still qualify. */ }
    }
    if (observation.state?.provider === "microsoft" && (outlookOrganizer === "series" || outlookOrganizer === "content")) {
      try {
        const context = await readGraphMeetingContext({ actorID, eventID, calendarID: event.originCalendarID });
        const native = await microsoftAdapter.observeGraphMeetingCancellation!(context, AbortSignal.timeout(20_000));
        return { ...observation, outlookCancellation: { calendarID: event.originCalendarID, expectedRevision: event.revision, seriesVersion: native.version, scopes: native.scopes } };
      } catch { /* A one-off may still qualify for the existing cancellation. */ }
    }
    const instanceVersion = event.seriesID
      ? await readProviderOrganizerInstanceVersion(actorID, eventID)
      : undefined;
    const prepared = await prepareProviderOrganizer(actorID, {
      ...(instanceVersion
        ? { scope: "occurrence", expectedInstanceVersion: instanceVersion }
        : {}),
      operationID: randomUUID(),
      eventID,
      calendarID: event.originCalendarID,
      ...(observation.state!.provider !== "google"
        ? { provider: observation.state!.provider, notificationPolicy: "server-invite" }
        : { provider: "google", sendUpdates: "all" }),
      action: "delete",
      expectedRevision: event.revision,
      expectedStateVersion: observation.version,
    });
    if (prepared.kind !== "prepared") return observation;
    const ctx = prepared.context;
    if (ctx.request.provider === "microsoft") {
      const transport = await microsoftAdapter.microsoftOrganizer!(actorID, ctx.link.accountID, ctx.link.externalCalendarID, AbortSignal.timeout(10_000));
      const native = await transport.read(ctx.mapping!.externalEventID);
      if (!native || native.etag !== ctx.mapping!.etag) return observation;
      const actions: ("update" | "delete")[] = ["delete"];
      if (outlookOrganizer === "series" || outlookOrganizer === "content") {
        try {
          const content = await transport.read(ctx.mapping!.externalEventID, true);
          if (content?.etag === ctx.mapping!.etag && matchesRsvpEventProjection("microsoft", event, microsoftMeetingContentProjection(content, transport.email))) actions.unshift("update");
        } catch { /* Cancellation can remain available without content proof. */ }
      }
      return { ...observation, organizerEdit: { provider: "microsoft" as const, calendarID: ctx.request.calendarID, expectedRevision: event.revision, actions } };
    }
    if (ctx.request.provider === "caldav") {
      const actions: ("update" | "delete")[] = [];
      let timeEdit: true | undefined;
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
          ) {
            actions.push(action);
            if (action === "update") {
              try {
                caldavOrganizerTimeEvidence(native.data);
                timeEdit = true;
              } catch {
                /* Content-only permission remains available. */
              }
            }
          }
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
          ...(timeEdit ? { timeEdit } : {}),
        },
      };
    }

    const transport = await googleAdapter.organizer!(
      actorID,
      ctx.link.accountID,
      ctx.link.externalCalendarID,
      AbortSignal.timeout(10_000),
    );
    const native = await transport.read(
      ctx.mapping!.externalEventID,
      ctx.instance,
    );
    if (
      !native ||
      native.etag !== ctx.mapping!.etag ||
      !matchesRsvpEventProjection(
        "google",
        ctx.event!,
        organizerProjection(native, ctx.instance),
        ctx.instance,
      )
    )
      return observation;
    return {
      ...observation,
      organizerEdit: {
        ...(ctx.instance
          ? { scope: "occurrence" as const, instanceVersion }
          : {}),
        provider: "google" as const,
        calendarID: ctx.request.calendarID,
        expectedRevision: event.revision,
      },
    };
  } catch {
    return observation;
  }
}

function organizerProjection(
  native: Record<string, unknown>,
  instance?: import("@musubi/types").ProviderRsvpInstance,
) {
  if (!instance) return googleReminderEventEvidence(native);
  const {
    recurringEventId: _parent,
    originalStartTime: _slot,
    ...content
  } = native;
  return {
    ...googleReminderEventEvidence(content),
    externalSeriesID: instance.externalSeriesID,
    originalStart: instance.originalStart,
  };
}
