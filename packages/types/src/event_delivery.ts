import { z } from "zod";

/** A receipt describes one destination, never a global provider confirmation. */
export const EventDeliveryTargetSchema = z.object({
  targetId: z.uuid(),
  calendarId: z.uuid(),
  calendarName: z.string().nullable(),
  provider: z.string(),
  connected: z.boolean(),
  owned: z.boolean(),
  operationId: z.uuid().nullable(),
  action: z.enum(["create", "update", "delete"]).nullable(),
  status: z.enum([
    "unknown",
    "pending",
    "attempting",
    "completed",
    "not-needed",
    "conflict",
    "not-written",
    "unconfirmed",
    "retry",
    "blocked",
    "cancelled",
  ]),
  revision: z.number().int().positive().nullable(),
  latestRevision: z.number().int().positive().nullable(),
  updatedAt: z.coerce.date().nullable(),
  retryAt: z.coerce.date().nullable(),
  issue: z
    .enum([
      "reconnect-required",
      "write-denied",
      "write-unsupported",
      "permission-unknown",
      "conflict",
      "unconfirmed",
      "destination-unavailable",
      "recovery-unavailable",
      "delivery-failed",
    ])
    .nullable()
    .optional(),
});

export const EventDeliverySchema = z.object({
  eventId: z.uuid(),
  // Null when only the caller's retained receipts remain accessible.
  localRevision: z.number().int().positive().nullable(),
  targets: z.array(EventDeliveryTargetSchema),
});

export type EventDeliveryTarget = z.infer<typeof EventDeliveryTargetSchema>;
export type EventDelivery = z.infer<typeof EventDeliverySchema>;

export const EventDeliveryContentSchema = z.object({
  title: z.string(),
  start: z.coerce.date(),
  end: z.coerce.date(),
  isAllDay: z.boolean(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  recurrence: z.string().nullable(),
});

export const EventDeliveryConflictSchema = z.object({
  eventId: z.uuid(),
  operationId: z.uuid(),
  latestOperationId: z.uuid(),
  localRevision: z.number().int().positive().nullable(),
  local: EventDeliveryContentSchema.nullable(),
  remote: EventDeliveryContentSchema.nullable(),
  remoteEtag: z.string().nullable(),
  action: z.enum(["create", "update", "delete"]),
  canResolve: z.boolean(),
  reason: z
    .enum([
      "write-denied",
      "write-unsupported",
      "permission-unknown",
      "reconnect-required",
      "recovery-unavailable",
    ])
    .nullable(),
});

export const ResolveEventDeliveryRequestSchema = z
  .object({
    mutationId: z.uuid(),
    expectedLocalRevision: z.number().int().positive().nullable(),
    expectedLatestOperationId: z.uuid(),
    expectedRemoteExists: z.boolean(),
    expectedRemoteEtag: z.string().nullable(),
  })
  .strict();

export type EventDeliveryContent = z.infer<typeof EventDeliveryContentSchema>;
export type EventDeliveryConflict = z.infer<typeof EventDeliveryConflictSchema>;
export type ResolveEventDeliveryRequest = z.infer<
  typeof ResolveEventDeliveryRequestSchema
>;
