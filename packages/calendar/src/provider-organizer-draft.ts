import {
  ProviderOrganizerRequestSchema,
  type Event,
  type ProviderEventStateResponse,
  type ProviderOrganizerRequest,
} from "@musubi/types";
export type OrganizerDraft = {
  title: string;
  description: string;
  location: string;
  guests: string;
  start: string;
  end: string;
  timeZone: string;
  allDay: boolean;
};
export const organizerNotice =
  "Google will be asked to notify all guests. Guest notification delivery cannot be verified. These guests do not become Musubi calendar members or receive a second Musubi invitation.";
export function organizerNotificationNotice(provider: "google" | "caldav") {
  return provider === "google"
    ? organizerNotice
    : organizerNotice.replace("Google", "The CalDAV server");
}
export function organizerDraft(
  event?: Event,
  provider: "google" | "caldav" = "google",
): OrganizerDraft {
  const day = new Date().toISOString().slice(0, 10),
    time = event?.timeModel;
  return {
    title: event?.title ?? "",
    description: event?.description ?? "",
    location: event?.location ?? "",
    guests: "",
    start:
      time?.kind === "zoned"
        ? time.startLocal
        : event?.isAllDay
          ? event.start.toISOString().slice(0, 10)
          : event
            ? ""
            : `${day}T09:00:00`,
    end:
      time?.kind === "zoned"
        ? time.endLocal
        : event?.isAllDay
          ? event.end.toISOString().slice(0, 10)
          : event
            ? ""
            : `${day}T10:00:00`,
    timeZone:
      time?.kind === "zoned"
        ? time.timeZone
        : event
          ? ""
          : provider === "caldav"
            ? "UTC"
            : Intl.DateTimeFormat().resolvedOptions().timeZone,
    allDay: event?.isAllDay ?? false,
  };
}
export function organizerRequest(
  action: ProviderOrganizerRequest["action"],
  draft: OrganizerDraft,
  changed: readonly (keyof OrganizerDraft)[],
  identity: {
    operationID: string;
    eventID: string;
    calendarID: string;
    color: string;
    provider?: "google" | "caldav";
  },
  observation?: ProviderEventStateResponse,
): ProviderOrganizerRequest {
  const {
    color,
    provider = observation?.organizerEdit?.provider ?? "google",
    ...ids
  } = identity;
  const common =
    provider === "caldav"
      ? { ...ids, provider, notificationPolicy: "server-invite" }
      : { ...ids, provider, sendUpdates: "all" };
  const time = draft.allDay
    ? {
        kind: "all-day",
        startDate: draft.start.slice(0, 10),
        endDate: draft.end.slice(0, 10),
      }
    : {
        kind: "zoned",
        timeZone: draft.timeZone,
        startLocal:
          draft.start.length === 16 ? `${draft.start}:00` : draft.start,
        endLocal: draft.end.length === 16 ? `${draft.end}:00` : draft.end,
      };
  if (action === "create")
    return ProviderOrganizerRequestSchema.parse({
      ...common,
      action,
      color,
      content: {
        title: draft.title,
        description: draft.description || null,
        location: draft.location || null,
      },
      time,
      guests: draft.guests
        .split(/[\n,;]/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((email) => ({ email, optional: false })),
    });
  const expected = {
    expectedRevision: observation?.organizerEdit?.expectedRevision,
    expectedStateVersion: observation?.version,
    ...(observation?.organizerEdit?.scope === "occurrence"
      ? {
          scope: "occurrence",
          expectedInstanceVersion: observation.organizerEdit.instanceVersion,
        }
      : {}),
  };
  if (action === "delete")
    return ProviderOrganizerRequestSchema.parse({
      ...common,
      action,
      ...expected,
    });
  const patch: Record<string, unknown> = {};
  for (const key of ["title", "description", "location"] as const)
    if (changed.includes(key))
      patch[key] = draft[key] || (key === "title" ? "" : null);
  if (
    observation?.organizerEdit?.scope !== "occurrence" &&
    changed.some((key) => ["start", "end", "timeZone", "allDay"].includes(key))
  ) {
    if (provider === "caldav" && !observation?.organizerEdit?.timeEdit)
      throw new Error("Time editing is not available for this meeting.");
    patch.time = time;
  }
  return ProviderOrganizerRequestSchema.parse({
    ...common,
    action,
    ...expected,
    patch,
  });
}

/** Only a stored child with an explicit current occurrence observation can open
 * organizer controls. Generated occurrences never supply their master's proof. */
export function canManageProviderOrganizer(
  event: Event | undefined,
  observation: Pick<ProviderEventStateResponse, "organizerEdit"> | undefined,
): boolean {
  const edit = observation?.organizerEdit;
  if (
    !event ||
    !edit ||
    event.recurrence ||
    event.isCanceled ||
    event.revision !== edit.expectedRevision ||
    event.originCalendarID !== edit.calendarID
  )
    return false;
  return edit.scope === "occurrence"
    ? !!(edit.provider === "google" && event.seriesID && event.originalStart && edit.instanceVersion)
    : !event.seriesID && !event.originalStart;
}
