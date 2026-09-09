import { z } from "zod";
import { EventTimeEditSchema } from "./event_time";
import type { Event } from "./event";
const time = EventTimeEditSchema.refine(
  (value) =>
    value.kind !== "floating" &&
    (value.kind !== "zoned" || value.startLocal < value.endLocal),
  "A named zone with a positive duration or all-day dates are required",
);
const common = z.object({
  operationID: z.uuid().transform((value) => value.toLowerCase()),
  calendarID: z.uuid(),
  eventID: z.uuid(),
  provider: z.literal("google"),
  sendUpdates: z.literal("all"),
});
const content = z.object({
  title: z.string().trim().min(1).max(1024),
  description: z.string().max(100_000).nullable(),
  location: z.string().max(4096).nullable(),
});
const guest = z
  .object({
    email: z.email().transform((value) => value.toLowerCase()),
    optional: z.boolean(),
  })
  .strict();
export const ProviderOrganizerRequestSchema = z.discriminatedUnion("action", [
  common
    .extend({
      action: z.literal("create"),
      content: content.strict(),
      time,
      guests: z
        .array(guest)
        .min(1)
        .max(100)
        .refine(
          (values) =>
            new Set(values.map((value) => value.email)).size === values.length,
          "Duplicate guest",
        ),
      color: z.string().max(64),
    })
    .strict(),
  common
    .extend({
      action: z.literal("update"),
      expectedRevision: z.number().int().positive(),
      expectedStateVersion: z.string().regex(/^[0-9a-f]{64}$/),
      patch: content
        .partial()
        .extend({ time: time.optional() })
        .strict()
        .refine((value) => Object.keys(value).length > 0, "Choose a change"),
    })
    .strict(),
  common
    .extend({
      action: z.literal("delete"),
      expectedRevision: z.number().int().positive(),
      expectedStateVersion: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .strict(),
]);
export type ProviderOrganizerRequest = z.infer<
  typeof ProviderOrganizerRequestSchema
>;
export const OrganizerDispatchSchema = z
  .object({
    kind: z.literal("google-organizer-dispatch"),
    version: z.literal(1),
    startedAt: z.iso.datetime(),
    acceptedAt: z.iso.datetime().optional(),
    cancellationTombstone: z
      .object({
        revision: z.number().int().positive(),
        deletedAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
  })
  .strict();
/** Private immutable provider operation; never a Musubi attendance instruction. */
export type ProviderOrganizerIntent = {
  request: ProviderOrganizerRequest;
  baseline: Record<string, unknown> | null;
  desired: Record<string, unknown> | null;
  mappingID: string | null;
  sourceEvent: Event;
  dispatch?: z.infer<typeof OrganizerDispatchSchema>;
};
export const ProviderOrganizerReceiptSchema = z
  .object({
    operationID: z.uuid(),
    eventID: z.uuid(),
    replayed: z.boolean(),
    status: z.string(),
    localCommitted: z.literal(true),
    notificationDelivery: z.literal("unknown"),
  })
  .strict();

export const ProviderOrganizerCalendarSchema = z
  .object({
    provider: z.literal("google"),
    calendarID: z.uuid(),
    sendUpdates: z.literal("all"),
  })
  .strict();

/** Explicit validation rejection before organizer admission is attempted. */
export class OrganizerAdmissionRejectedError extends Error {
  readonly organizerAdmissionRejected = true;
}
