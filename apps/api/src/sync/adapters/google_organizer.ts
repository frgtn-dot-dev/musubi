import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { resolveEventTimeEdit } from "@musubi/calendar";
import {
  OccurrenceStartSchema,
  type ProviderRsvpInstance,
  EventWriteError,
  EventTimeZoneSchema,
  type GoogleOrganizerRequest,
} from "@musubi/types";
import { requireEventEtag, ProviderEventWriteError } from "../event_write";
import { googleEventCreateID } from "../event_create_identity";
const endpoint = z.union([
  z
    .object({ date: z.iso.date(), dateTime: z.never().optional() })
    .passthrough(),
  z
    .object({
      dateTime: z.iso
        .datetime({ offset: true })
        .refine((value) => !/\.\d{4}/.test(value)),
      timeZone: EventTimeZoneSchema,
      date: z.never().optional(),
    })
    .passthrough(),
]);
const originalEndpoint = z.union([
  z.object({ date: z.iso.date() }).strict(),
  z
    .object({
      dateTime: z.iso
        .datetime({ offset: true })
        .refine((value) => !/\.\d{4}/.test(value)),
      timeZone: EventTimeZoneSchema.optional(),
    })
    .strict(),
]);
const attendee = z
  .object({
    email: z.email(),
    optional: z.boolean().optional(),
    resource: z.literal(false).optional(),
    self: z.boolean().optional(),
    organizer: z.boolean().optional(),
    responseStatus: z.enum([
      "needsAction",
      "accepted",
      "tentative",
      "declined",
    ]),
  })
  .passthrough();
const resource = z
  .object({
    id: z.string().min(1),
    etag: z.string(),
    iCalUID: z.string().min(1),
    status: z.enum(["confirmed", "tentative"]),
    organizer: z
      .object({ email: z.email(), self: z.literal(true) })
      .passthrough(),
    attendees: z.array(attendee).min(1).max(101),
    attendeesOmitted: z.literal(false).optional(),
    privateCopy: z.literal(false).optional(),
    locked: z.literal(false).optional(),
    eventType: z.literal("default").optional(),
    recurrence: z.never().optional(),
    recurringEventId: z.string().min(1).optional(),
    originalStartTime: originalEndpoint.optional(),
    start: endpoint,
    end: endpoint,
    updated: z.iso.datetime({ offset: true }).optional(),
    created: z.iso.datetime({ offset: true }).optional(),
    sequence: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type GoogleOrganizerNative = z.infer<typeof resource>;
export function googleOrganizerNative(
  raw: unknown,
  email: string,
  instance?: ProviderRsvpInstance,
): GoogleOrganizerNative {
  const result = resource.safeParse(raw);
  if (!result.success) throw new EventWriteError("organizer", "unsupported");
  const value = structuredClone(result.data),
    own = email.toLowerCase();
  requireEventEtag(value.etag);
  if (instance) assertGoogleOrganizerInstanceIdentity(value, instance);
  else if (value.recurringEventId || value.originalStartTime)
    throw new EventWriteError("organizer", "unsupported");
  if (
    value.organizer.email.toLowerCase() !== own ||
    new Set(value.attendees.map((item) => item.email.toLowerCase())).size !==
      value.attendees.length ||
    value.attendees.some(
      (item) =>
        (item.self && item.email.toLowerCase() !== own) ||
        (item.organizer && item.email.toLowerCase() !== own),
    ) ||
    !value.attendees.some((item) => item.email.toLowerCase() !== own)
  )
    throw new EventWriteError("organizer", "unsupported");
  if (
    !!value.start.date !== !!value.end.date ||
    value.end.timeZone !== value.start.timeZone ||
    Date.parse(String(value.end.date ?? value.end.dateTime)) <=
      Date.parse(String(value.start.date ?? value.start.dateTime))
  )
    throw new EventWriteError("organizer", "unsupported");
  return value;
}
export function assertGoogleOrganizerInstanceIdentity(
  raw: Record<string, unknown>,
  instance: ProviderRsvpInstance,
) {
  const original = originalEndpoint.safeParse(raw.originalStartTime);
  const identity = OccurrenceStartSchema.safeParse(
    !original.success
      ? undefined
      : "date" in original.data
        ? { kind: "date", value: original.data.date }
        : {
            kind: "instant",
            value: new Date(original.data.dateTime).toISOString(),
          },
  );
  if (
    typeof raw.id !== "string" ||
    !raw.id ||
    raw.id === instance.externalSeriesID ||
    raw.recurringEventId !== instance.externalSeriesID ||
    !identity.success ||
    !isDeepStrictEqual(identity.data, instance.originalStart) ||
    raw.recurrence !== undefined
  )
    throw new ProviderEventWriteError("provider-conflict");
}
function timeBody(input: unknown) {
  let time;
  try {
    time = resolveEventTimeEdit(input);
  } catch (error) {
    if (error instanceof RangeError)
      throw new EventWriteError("organizer", "unsupported");
    throw error;
  }
  if (!time.isAllDay && time.end.getTime() <= time.start.getTime())
    throw new EventWriteError("organizer", "unsupported");
  if (
    time.timeModel.kind === "floating" ||
    time.timeModel.kind === "legacy-unknown"
  )
    throw new EventWriteError("organizer", "unsupported");
  return time.isAllDay
    ? {
        start: { date: time.start.toISOString().slice(0, 10) },
        end: {
          date: new Date(time.end.getTime() + 86400000)
            .toISOString()
            .slice(0, 10),
        },
      }
    : {
        start: {
          dateTime: time.start.toISOString(),
          timeZone:
            time.timeModel.kind === "zoned"
              ? time.timeModel.timeZone
              : undefined,
        },
        end: {
          dateTime: time.end.toISOString(),
          timeZone:
            time.timeModel.kind === "zoned"
              ? time.timeModel.timeZone
              : undefined,
        },
      };
}
export function googleOrganizerBody(
  request: GoogleOrganizerRequest,
  baseline: GoogleOrganizerNative | null,
  own: string,
): Record<string, unknown> | null {
  if (
    request.action !== "create" &&
    baseline &&
    !!baseline.recurringEventId !== (request.scope === "occurrence")
  )
    throw new EventWriteError("organizer", "unsupported");
  if (request.action === "delete") {
    if (!baseline) throw new ProviderEventWriteError("provider-conflict");
    return null;
  }
  if (request.action === "create") {
    if (
      baseline ||
      request.guests.some((guest) => guest.email === own.toLowerCase())
    )
      throw new EventWriteError("organizer", "unsupported");
    return {
      id: googleEventCreateID({ operationID: request.operationID }),
      summary: request.content.title,
      description: request.content.description ?? "",
      location: request.content.location ?? "",
      ...timeBody(request.time),
      attendees: request.guests.map((guest) => ({
        ...guest,
        responseStatus: "needsAction",
      })),
      extendedProperties: {
        private: { musubiOperationID: request.operationID },
      },
    };
  }
  if (!baseline) throw new ProviderEventWriteError("provider-conflict");
  if (
    !!baseline.recurringEventId !== (request.scope === "occurrence") ||
    (request.scope === "occurrence" && request.patch.time)
  )
    throw new EventWriteError("organizer", "unsupported");
  const patch: Record<string, unknown> = {};
  for (const [key, native] of [
    ["title", "summary"],
    ["description", "description"],
    ["location", "location"],
  ] as const)
    if (request.patch[key] !== undefined)
      patch[native] = request.patch[key] ?? "";
  if (request.patch.time) {
    const time = timeBody(request.patch.time);
    for (const key of ["start", "end"] as const) {
      const endpoint: Record<string, unknown> = {
        ...baseline[key],
        ...time[key],
      };
      if ("date" in time[key]) {
        delete endpoint.dateTime;
        delete endpoint.timeZone;
      } else delete endpoint.date;
      patch[key] = endpoint;
    }
  }
  return patch;
}
/** Full preservation comparison for updates: no attendee response or opaque
 * extension may be silently rebased. Only validated server version fields vary. */
function comparableEndpoint(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const copy = { ...value } as Record<string, unknown>;
  if (typeof copy.dateTime === "string")
    copy.dateTime = new Date(copy.dateTime).toISOString();
  return copy;
}
export function matchesGoogleOrganizer(
  actual: unknown,
  request: GoogleOrganizerRequest,
  baseline: GoogleOrganizerNative | null,
  own: string,
  instance?: ProviderRsvpInstance,
): boolean {
  try {
    const current = googleOrganizerNative(actual, own, instance),
      patch = googleOrganizerBody(request, baseline, own);
    if (!patch) return false;
    if (request.action === "create") {
      if (current.conferenceData || current.hangoutLink || current.attachments)
        return false;
      if (
        current.id !== patch.id ||
        !isDeepStrictEqual(current.extendedProperties, patch.extendedProperties)
      )
        return false;
      for (const key of ["summary", "description", "location", "start", "end"])
        if (
          !isDeepStrictEqual(
            ["start", "end"].includes(key)
              ? comparableEndpoint(current[key])
              : (current[key] ?? ""),
            ["start", "end"].includes(key)
              ? comparableEndpoint(patch[key])
              : patch[key],
          )
        )
          return false;
      const guests = current.attendees
        .filter((item) => item.email.toLowerCase() !== own.toLowerCase())
        .map((item) => ({
          email: item.email.toLowerCase(),
          optional: item.optional ?? false,
          responseStatus: item.responseStatus,
        }))
        .sort((a, b) => a.email.localeCompare(b.email));
      const expected = (patch.attendees as typeof guests)
        .slice()
        .sort((a, b) => a.email.localeCompare(b.email));
      return (
        isDeepStrictEqual(guests, expected) &&
        current.attendees.every(
          (item) =>
            item.email.toLowerCase() !== own.toLowerCase() ||
            (item.self === true && item.organizer === true),
        )
      );
    }
    const expected: Record<string, unknown> = {
      ...structuredClone(baseline!),
      ...patch,
    };
    const observed: Record<string, unknown> = structuredClone(current);
    for (const key of ["start", "end"]) {
      expected[key] = comparableEndpoint(expected[key]);
      observed[key] = comparableEndpoint(observed[key]);
    }
    for (const key of ["etag", "updated", "sequence"]) {
      delete expected[key];
      delete observed[key];
    }
    return isDeepStrictEqual(observed, expected);
  } catch {
    return false;
  }
}
