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
export function organizerDraft(event?: Event): OrganizerDraft {
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
  },
  observation?: ProviderEventStateResponse,
): ProviderOrganizerRequest {
  const { color, ...ids } = identity;
  const common = { ...ids, provider: "google", sendUpdates: "all" };
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
    changed.some((key) => ["start", "end", "timeZone", "allDay"].includes(key))
  )
    patch.time = time;
  return ProviderOrganizerRequestSchema.parse({
    ...common,
    action,
    ...expected,
    patch,
  });
}
