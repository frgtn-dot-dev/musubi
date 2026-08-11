import {
  CalendarSchema,
  EventSchema,
  InviteSchema,
  PageDocumentSchema,
  SettingsDocumentSchema,
  SettingsSchema,
} from "@musubi/types";
import { defaultEventPageTheme, EventPageThemeSchema } from "@musubi/types";
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
  theme: EventPageThemeSchema.default(defaultEventPageTheme),
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
  theme: EventPageThemeSchema.default(defaultEventPageTheme),
  title: z.string(),
  url: z.string().nullish(),
});

export type PublicEvent = z.infer<typeof PublicEventSchema>;

// ── Scheduling (group poll) ──────────────────────────────────────────────────
export const PollSlotSchema = z.object({
  end: z.coerce.date(),
  id: z.string(),
  ifNeeded: z.array(z.string()).default([]),
  no: z.array(z.string()).default([]),
  start: z.coerce.date(),
  yes: z.array(z.string()).default([]),
});

/** One participant's row in the grid: who they are and how they answered. */
export const PollPersonSchema = z.object({
  answers: z.record(z.string(), z.enum(["if-needed", "no", "yes"])).default({}),
  id: z.string(),
  name: z.string(),
});

export const PollSchema = z.object({
  approximateStartTime: z.string().nullish(),
  chosenSlotID: z.string().nullish(),
  /** Shut to new answers, whether by hand or by a deadline that has gone by. */
  closed: z.boolean().default(false),
  /** When it shuts on its own, if it does. */
  deadline: z.coerce.date().nullish(),
  description: z.string().nullish(),
  durationMinutes: z.number(),
  /** The reader's own answers, keyed by slot. Empty when nobody is signed in. */
  mine: z.record(z.string(), z.enum(["if-needed", "no", "yes"])).default({}),
  /** Which row in `people` is the reader's, so the grid shows them once. */
  mineID: z.string().nullish(),
  people: z.array(PollPersonSchema).default([]),
  respondents: z.number().default(0),
  slots: z.array(PollSlotSchema).default([]),
  title: z.string(),
});

export type Poll = z.infer<typeof PollSchema>;
export type PollPerson = z.infer<typeof PollPersonSchema>;
export type PollSlot = z.infer<typeof PollSlotSchema>;
export type VoteValue = "if-needed" | "no" | "yes";

/** A poll in the organizer's own list. */
export const PollSummarySchema = z.object({
  approximateStartTime: z.string().nullish(),
  /** Set when a time was picked; a poll can be closed without one. */
  chosenSlotID: z.string().nullish(),
  /** Shut to answers, decided by the server: a deadline is a clock comparison. */
  closed: z.boolean().default(false),
  /** When the organizer closed it, which a passed deadline does not set. */
  closedAt: z.coerce.date().nullish(),
  createdAt: z.coerce.date(),
  deadline: z.coerce.date().nullish(),
  durationMinutes: z.number(),
  id: z.string(),
  title: z.string(),
  token: z.string(),
  url: z.string(),
});

export type PollSummary = z.infer<typeof PollSummarySchema>;

export const PollCalendarDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.coerce.date(),
  id: z.string(),
  ifNeeded: z.number().int().nonnegative(),
  no: z.number().int().nonnegative(),
  start: z.coerce.date(),
  yes: z.number().int().nonnegative(),
});

export const PollCalendarSchema = PollSummarySchema.extend({
  days: z.array(PollCalendarDaySchema),
  respondents: z.number().int().nonnegative(),
  role: z.enum(["organizer", "participant"]),
});

export type PollCalendar = z.infer<typeof PollCalendarSchema>;
export type PollCalendarDay = z.infer<typeof PollCalendarDaySchema>;

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
