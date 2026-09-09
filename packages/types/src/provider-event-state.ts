import { z } from "zod";

const person = z.object({ address: z.string().nullable(), name: z.string().nullable(), self: z.boolean().nullable() }).strict();
export const ProviderEventStateSchema = z.object({
  provider: z.enum(["google", "microsoft", "caldav"]),
  organizer: person.nullable(),
  // null means provider evidence is absent; owning a mirror is not organizer proof.
  isOrganizer: z.boolean().nullable(),
  attendees: z.array(person.extend({ role: z.string().nullable(), response: z.string().nullable() }).strict()),
  attendeesComplete: z.boolean(),
  ownResponse: z.string().nullable(),
  reminders: z.discriminatedUnion("provider", [
    z.object({ provider: z.literal("google"), useDefault: z.boolean().nullable(), overrides: z.array(z.object({ method: z.string().nullable(), minutes: z.number().int().nullable() }).strict()) }).strict(),
    z.object({ provider: z.literal("microsoft"), isOn: z.boolean().nullable(), minutesBeforeStart: z.number().int().nullable() }).strict(),
    z.object({ provider: z.literal("caldav"), alarms: z.array(z.object({ action: z.string().nullable(), trigger: z.string().nullable(), related: z.string().nullable(), repeat: z.string().nullable(), duration: z.string().nullable() }).strict()) }).strict(),
  ]),
  // Provider-native values are intentionally not collapsed into another provider's enum.
  availability: z.string().nullable(),
  privacy: z.string().nullable(),
  status: z.string().nullable(),
  eventType: z.string().nullable(),
  conferenceURLs: z.array(z.string()),
}).strict();
export type ProviderEventState = z.infer<typeof ProviderEventStateSchema>;
export const ProviderEventStateResponseSchema = z.object({ state: ProviderEventStateSchema.nullable(), version: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(), reminderEdit: z.discriminatedUnion("provider", [z.object({ provider: z.literal("google"), expectedRevision: z.number().int().positive() }).strict(), z.object({ provider: z.literal("caldav"), expectedRevision: z.number().int().positive(), minutesBeforeStart: z.number().int().min(0).max(40320).nullable(), scope: z.literal("series").optional() }).strict()]).optional(), organizerEdit: z.object({ provider: z.enum(["google", "caldav"]), calendarID: z.uuid(), expectedRevision: z.number().int().positive(), actions: z.array(z.enum(["update", "delete"])).min(1).optional() }).strict().optional(), rsvpEdit: z.object({ provider: z.enum(["google", "caldav", "microsoft"]), expectedRevision: z.number().int().positive() }).strict().optional() }).strict();

export type ProviderEventStateResponse = z.infer<typeof ProviderEventStateResponseSchema>;
