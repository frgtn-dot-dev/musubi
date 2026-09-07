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
});

export const EventDeliverySchema = z.object({
  eventId: z.uuid(),
  // Null when only the caller's retained receipts remain accessible.
  localRevision: z.number().int().positive().nullable(),
  targets: z.array(EventDeliveryTargetSchema),
});

export type EventDeliveryTarget = z.infer<typeof EventDeliveryTargetSchema>;
export type EventDelivery = z.infer<typeof EventDeliverySchema>;
