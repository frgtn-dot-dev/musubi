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
