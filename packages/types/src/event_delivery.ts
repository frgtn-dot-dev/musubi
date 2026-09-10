import { z } from "zod";
import { CaldavAlarmWriteSchema, GoogleReminderWriteSchema } from "./provider-reminders";
import { ProviderEventStateSchema } from "./provider-event-state";
import { EventTimeModelSchema, OccurrenceStartSchema } from "./event_time";

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
  graphRsvpPhase: z.enum(["queued", "dispatched", "accepted", "observed", "absent"]).optional(),
  organizerPhase: z.enum(["queued", "dispatched", "accepted", "observed", "absent", "unchanged"]).optional(),
  graphCreateCheck: z.literal(true).optional(),
  graphCreateAdopted: z.literal(true).optional(),
  alarmDiscarded: z.literal(true).optional(),
  alarmDiscardRevision: z.number().int().positive().optional(),
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

/** Discovery only; opening an item loads current, authorized delivery receipts. */
export const EventDeliveryInboxSchema = z.object({
  items: z.array(
    z.object({
      eventId: z.uuid(),
      // Last owned unresolved intent's title, never newer private event content.
      savedTitle: z.string(),
    }),
  ),
  nextCursor: z.uuid().nullable(),
});
export type EventDeliveryInbox = z.infer<typeof EventDeliveryInboxSchema>;

export const EventDeliveryContentSchema = z.object({
  title: z.string(),
  start: z.coerce.date(),
  end: z.coerce.date(),
  isAllDay: z.boolean(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  recurrence: z.string().nullable(),
  isCanceled: z.boolean().optional(),
  timeModel: EventTimeModelSchema.optional(),
  originalStart: OccurrenceStartSchema.optional(),
});

export const EventDeliveryScopeResolutionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("following-delete"), originalStart: OccurrenceStartSchema }).strict(),
  z.object({ kind: z.literal("series-delete") }).strict(),
  z.object({ kind: z.literal("following-create"), originalStart: OccurrenceStartSchema, newSeriesId: z.uuid() }).strict(),
  z.object({ kind: z.literal("following-update"), originalStart: OccurrenceStartSchema, newSeriesId: z.uuid() }).strict(),
]);

export const EventDeliveryConflictSchema = z.object({
  graphCreateAdoption: z.object({ stateVersion: z.string().regex(/^[0-9a-f]{64}$/), occurrenceCount: z.number().int().min(1).max(366) }).strict().optional(),
  scopeResolution: EventDeliveryScopeResolutionSchema.optional(),
  splitFuture: EventDeliveryContentSchema.optional(),
  eventId: z.uuid(),
  operationId: z.uuid(),
  latestOperationId: z.uuid(),
  localRevision: z.number().int().positive().nullable(),
  masterRevision: z.number().int().positive().optional(),
  local: EventDeliveryContentSchema.nullable(),
  remote: EventDeliveryContentSchema.nullable(),
  remoteEtag: z.string().nullable(),
  action: z.enum(["create", "update", "delete"]),
  caldavAlarmResolution: z.object({ scope: z.literal("series").optional(), desired: CaldavAlarmWriteSchema, remote: CaldavAlarmWriteSchema, stateVersion: z.string().regex(/^[0-9a-f]{64}$/) }).strict().optional(),
  reminderResolution: z.object({
    desired: GoogleReminderWriteSchema,
    remote: ProviderEventStateSchema.shape.reminders,
    stateVersion: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict().optional(),
  rsvpResolution: z.object({
    desired: z.enum(["accepted", "tentative", "declined"]),
    remote: z.string().nullable(),
    baselineVersion: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict().optional(),
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
    expectedMasterRevision: z.number().int().positive().optional(),
    expectedScopeResolution: EventDeliveryScopeResolutionSchema.optional(),
    expectedRsvpBaselineVersion: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    expectedReminderStateVersion: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .strict();

export type EventDeliveryContent = z.infer<typeof EventDeliveryContentSchema>;
export type EventDeliveryConflict = z.infer<typeof EventDeliveryConflictSchema>;
export type ResolveEventDeliveryRequest = z.infer<
  typeof ResolveEventDeliveryRequestSchema
>;

export const GraphCreateAdoptionRequestSchema = z.object({
  kind: z.literal("graph-create-adoption"), mutationID: z.uuid(),
  expectedRevision: z.number().int().positive(), stateVersion: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type GraphCreateAdoptionRequest = z.infer<typeof GraphCreateAdoptionRequestSchema>;
export const GraphCreateAdoptionRecordSchema = z.object({
  kind: z.literal("graph-create-adoption"), version: z.literal(1), request: GraphCreateAdoptionRequestSchema,
  acceptedRevision: z.number().int().positive(), externalMasterID: z.string().min(1),
}).strict();
export type GraphCreateAdoptionRecord = z.infer<typeof GraphCreateAdoptionRecordSchema>;
export type EventDeliveryResolutionRequest = ResolveEventDeliveryRequest | GraphCreateAdoptionRequest;
