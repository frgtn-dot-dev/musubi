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

export const ServerCapabilitiesSchema = z
  .object({
    email: z.boolean().default(false),
    minClientVersion: z.string().optional(),
    socials: z.array(z.string()).default([]),
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
