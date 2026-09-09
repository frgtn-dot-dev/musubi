import { ProviderEventStateSchema, type ProviderEventState } from "./provider-event-state";
import type { EventTimeModel } from "./event_time";
import type { ProviderRsvpInstance } from "./provider-rsvp";
import { z } from "zod";

// This write contract is intentionally smaller than the lossless read model.
export const GoogleReminderWriteSchema = z.discriminatedUnion("useDefault", [
  z.object({ useDefault: z.literal(true) }).strict(),
  z
    .object({
      useDefault: z.literal(false),
      overrides: z
        .array(
          z
            .object({
              method: z.enum(["email", "popup"]),
              minutes: z.number().int().min(0).max(40320),
            })
            .strict(),
        )
        .max(5),
    })
    .strict(),
]);
export const ProviderReminderEditSchema = z
  .object({
    operationID: z.uuid().transform((value) => value.toLowerCase()),
    expectedRevision: z.number().int().positive(),
    expectedStateVersion: z.string().regex(/^[0-9a-f]{64}$/),
    provider: z.literal("google"),
    reminders: GoogleReminderWriteSchema,
  })
  .strict();
export type ProviderReminderEdit = z.infer<typeof ProviderReminderEditSchema>;
export type GoogleReminderWrite = z.infer<typeof GoogleReminderWriteSchema>;


export const ProviderReminderReceiptSchema = z.object({
  operationID: z.uuid(), replayed: z.boolean(), status: z.string(), localCommitted: z.literal(true),
}).strict();
export type ProviderReminderReceipt = z.infer<typeof ProviderReminderReceiptSchema>;

/** Private durable evidence for a bound existing instance. Never a public DTO. */
export type ProviderReminderInstanceIntent = {
  request: ProviderReminderEdit;
  baseline: Record<string, unknown>;
  nativeTime: EventTimeModel;
  instance: ProviderRsvpInstance;
  baselineState: ProviderEventState;
  desiredState: ProviderEventState;
  mappingID: string;
};
export function providerReminderDesiredState(input: ProviderEventState, reminders: GoogleReminderWrite): ProviderEventState {
  const state = ProviderEventStateSchema.parse(input);
  const desired = GoogleReminderWriteSchema.parse(reminders);
  if (state.provider !== "google" || state.reminders.provider !== "google") throw new Error("Unsupported provider reminder identity");
  state.reminders = { provider: "google", useDefault: desired.useDefault, overrides: desired.useDefault ? [] : desired.overrides };
  return state;
}

/** Resource alarms, not per-user preferences or calendar defaults. */
export const CaldavAlarmWriteSchema = z.object({ minutesBeforeStart: z.number().int().min(0).max(40320).nullable() }).strict();
export const CaldavAlarmEditSchema = z.object({
  operationID: z.uuid().transform(value => value.toLowerCase()),
  expectedRevision: z.number().int().positive(),
  expectedStateVersion: z.string().regex(/^[0-9a-f]{64}$/),
  provider: z.literal("caldav"),
  alarms: CaldavAlarmWriteSchema,
}).strict();
export type CaldavAlarmWrite = z.infer<typeof CaldavAlarmWriteSchema>;
export type CaldavAlarmEdit = z.infer<typeof CaldavAlarmEditSchema>;
export type AnyProviderReminderEdit = ProviderReminderEdit | CaldavAlarmEdit;
