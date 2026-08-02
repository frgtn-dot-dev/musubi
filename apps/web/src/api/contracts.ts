import {
  CalendarSchema,
  EventSchema,
  InviteSchema,
  PageDocumentSchema,
  SettingsDocumentSchema,
  SettingsSchema,
} from "@musubi/types";
import { z } from "zod";

export const CalendarsResponseSchema = z.array(CalendarSchema);
export const ImportedCalendarSchema = CalendarSchema.extend({
  imported: z.number().int().nonnegative(),
});

export const AttendeeSchema = z.object({
  id: z.string(),
  image: z.string().nullish(),
  name: z.string(),
});

export const AttendeesResponseSchema = z.array(AttendeeSchema);

export const EventsResponseSchema = z.object({
  deletedIds: z.array(z.string()),
  events: z.array(EventSchema),
  serverTime: z.string(),
});

export const RemoveEventResponseSchema = z.object({
  calendars: z.array(z.string()),
  id: z.string(),
  removed: z.boolean(),
});

export const SettingsResponseSchema = SettingsSchema;
export const SettingsDocumentResponseSchema = SettingsDocumentSchema;

export const PageResponseSchema = PageDocumentSchema;
export const PagesResponseSchema = z.array(PageDocumentSchema);

export const CalendarMemberSchema = z.object({
  id: z.string(),
  image: z.string().nullish(),
  name: z.string(),
  role: z.string(),
});
export const CalendarMembersResponseSchema = z.array(CalendarMemberSchema);
export const InvitesResponseSchema = z.array(InviteSchema);

export type CalendarMember = z.infer<typeof CalendarMemberSchema>;

// What an invite reveals before anyone commits: labels and a 30-day agenda.
export const InvitePreviewSchema = z.object({
  color: z.string(),
  events: z.array(
    z
      .object({
        end: z.coerce.date(),
        id: z.string(),
        isAllDay: z.boolean(),
        start: z.coerce.date(),
        title: z.string(),
      })
      .loose(),
  ),
  id: z.string(),
  members: z.array(
    z.object({
      id: z.string(),
      image: z.string().nullish(),
      name: z.string(),
    }),
  ),
  name: z.string(),
});

export type InvitePreview = z.infer<typeof InvitePreviewSchema>;

export const FederationConnectionSchema = z.object({
  id: z.string(),
  label: z.string(),
  remoteUserID: z.string(),
  server: z.string(),
});
export const FederationConnectionsResponseSchema = z.array(
  FederationConnectionSchema,
);

export type FederationConnection = z.infer<typeof FederationConnectionSchema>;

// A published event page. `null` from the API means the event is private, which
// is every event nobody has published.
export const EventShareSchema = z.object({
  attendeeVisibility: z.enum(["counts", "hidden", "names"]).default("counts"),
  indexable: z.boolean(),
  mode: z.enum(["link", "public"]),
  token: z.string(),
  url: z.string(),
});

export type EventShare = z.infer<typeof EventShareSchema>;

/** Who is coming, as much of it as the organizer lets a reader see. */
export const RsvpSummarySchema = z.object({
  counts: z.object({
    declined: z.number(),
    going: z.number(),
    maybe: z.number(),
  }),
  mine: z.enum(["declined", "going", "maybe"]).nullable(),
  names: z.array(z.string()).default([]),
  visibility: z.enum(["counts", "hidden", "names"]),
});

export type RsvpSummary = z.infer<typeof RsvpSummarySchema>;

/** The organizer's own view: every answer, whatever readers are allowed to see. */
export const EventRsvpsSchema = z.object({
  counts: z.object({
    declined: z.number(),
    going: z.number(),
    maybe: z.number(),
  }),
  declined: z.array(z.string()).default([]),
  going: z.array(z.string()).default([]),
  maybe: z.array(z.string()).default([]),
});

export type EventRsvps = z.infer<typeof EventRsvpsSchema>;
export type RsvpStatus = NonNullable<RsvpSummary["mine"]>;

/**
 * What an anonymous reader of a published page gets.
 *
 * Narrow on purpose (`apps/api/handlers/event_shares.ts`): no attendees, no
 * calendar, no ids. `recurrence` is the rule, not an expansion — the page works
 * out the next occurrence in the READER's timezone, because recurrence is
 * wall-clock and the server's zone is not the reader's.
 */
export const PublicEventSchema = z.object({
  description: z.string().nullish(),
  end: z.coerce.date(),
  indexable: z.boolean().default(false),
  isAllDay: z.boolean().default(false),
  isCanceled: z.boolean().default(false),
  location: z.string().nullish(),
  organizer: z.string(),
  recurrence: z.string().nullish(),
  start: z.coerce.date(),
  title: z.string(),
  url: z.string().nullish(),
});

export type PublicEvent = z.infer<typeof PublicEventSchema>;

export const ServerCapabilitiesSchema = z
  .object({
    email: z.boolean().default(false),
    minClientVersion: z.string().optional(),
    socials: z.array(z.string()).default([]),
    // Providers a BROWSER can finish. Narrower than `socials`, which also counts
    // the phone's native flows. Absent on an API older than this field, and the
    // login screen falls back accordingly.
    socialsWeb: z.array(z.string()).optional(),
    syncProviders: z.array(z.string()).default([]),
  })
  .loose();

export type ServerCapabilities = z.infer<typeof ServerCapabilitiesSchema>;

export type EventsResponse = z.infer<typeof EventsResponseSchema>;
export type Attendee = z.infer<typeof AttendeeSchema>;
export type ImportedCalendar = z.infer<typeof ImportedCalendarSchema>;
export type RemoveEventResponse = z.infer<
  typeof RemoveEventResponseSchema
>;
