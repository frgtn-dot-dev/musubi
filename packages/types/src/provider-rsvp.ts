import { OccurrenceStartSchema, type EventTimeModel } from "./event_time";
import { z } from "zod";
import { ProviderEventStateSchema, type ProviderEventState } from "./provider-event-state";
export const ProviderRsvpEditSchema = z.object({
  operationID: z.uuid().transform(value => value.toLowerCase()),
  expectedRevision: z.number().int().positive(),
  expectedStateVersion: z.string().regex(/^[0-9a-f]{64}$/),
  provider: z.literal("google"), response: z.enum(["accepted", "tentative", "declined"]),
  sendUpdates: z.literal("all"),
}).strict();
export type ProviderRsvpEdit = z.infer<typeof ProviderRsvpEditSchema>;
/** Private accepted parent/slot binding for an already materialized instance. */
export const ProviderRsvpInstanceSchema = z.object({
  seriesID: z.uuid(), parentRevision: z.number().int().positive(), parentMappingID: z.uuid(),
  externalSeriesID: z.string().min(1),
  originalStart: OccurrenceStartSchema.refine(value => value.kind !== "floating"),
}).strict();
export type ProviderRsvpInstance = z.infer<typeof ProviderRsvpInstanceSchema>;
/** Private outbox payload. Native raw evidence never belongs in a public DTO. */
export type ProviderRsvpIntent = {
  request: ProviderRsvpEdit;
  baseline: Record<string, unknown>;
  nativeTime?: EventTimeModel;
  instance?: ProviderRsvpInstance;
  baselineState: ProviderEventState;
  desiredState: ProviderEventState;
  mappingID: string;
};
export function providerRsvpDesiredState(input: ProviderEventState, copyEmail: string, response: ProviderRsvpEdit["response"]): ProviderEventState {
  const state = ProviderEventStateSchema.parse(input);
  const self = state.attendees.filter(item => item.self === true);
  if (state.provider !== "google" || !state.attendeesComplete || self.length !== 1 || !self[0]!.address || self[0]!.address.toLowerCase() !== copyEmail.toLowerCase() || state.isOrganizer === true || !state.organizer?.address || state.organizer.address.toLowerCase() === copyEmail.toLowerCase())
    throw new Error("Unsupported provider RSVP identity");
  self[0]!.response = response; state.ownResponse = response;
  return state;
}

/** Acceptance of a private intent; notification delivery remains unknowable. */
export const ProviderRsvpReceiptSchema = z.object({
  operationID: z.uuid(),
  replayed: z.boolean(),
  status: z.enum(["pending", "attempting", "completed", "not-needed", "not-written", "conflict", "unconfirmed", "retry", "blocked", "cancelled"]),
  localCommitted: z.literal(true),
  notificationDelivery: z.literal("unknown"),
}).strict();
export type ProviderRsvpReceiptResponse = z.infer<typeof ProviderRsvpReceiptSchema>;
