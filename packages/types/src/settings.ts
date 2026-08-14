import { z } from "zod";

export const CalendarViewSchema = z.enum(["week", "month", "day", "schedule"]);
export type CalendarView = z.infer<typeof CalendarViewSchema>;

export const SettingsSchema = z.object({
  showKanji: z.boolean(),
  notificationsOnByDefault: z.boolean(),
  defaultCalendarView: CalendarViewSchema,
  weekStartsOn: z.enum(["monday", "sunday"]),
  // how times render (12-hour with AM/PM vs 24-hour) and the order dates are written
  timeFormat: z.enum(["12h", "24h"]),
  dateFormat: z.enum(["dmy", "mdy", "ymd"]),
  theme: z.enum(["system", "dark", "light"]).default("system"),
  // optional (not defaulted): an omitted field must never reset the flag
  onboarded: z.boolean().optional(),
  // labels under the bottom tab icons; optional so old clients can't reset it
  tabBarLabels: z.boolean().optional(),
  // user-chosen calendar order (flat id list); optional for the same reason
  calendarOrder: z.array(z.string()).optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsPatchSchema = z
  .object({
    calendarOrder: z.array(z.string()).max(500).optional(),
    dateFormat: z.enum(["dmy", "mdy", "ymd"]).optional(),
    defaultCalendarView: CalendarViewSchema.optional(),
    notificationsOnByDefault: z.boolean().optional(),
    onboarded: z.boolean().optional(),
    showKanji: z.boolean().optional(),
    tabBarLabels: z.boolean().optional(),
    theme: z.enum(["system", "dark", "light"]).optional(),
    timeFormat: z.enum(["12h", "24h"]).optional(),
    weekStartsOn: z.enum(["monday", "sunday"]).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Settings patch cannot be empty.",
  });

export const SettingsDocumentSchema = z
  .object({
    revision: z.number().int().positive(),
    updatedAt: z.coerce.date(),
    value: SettingsSchema,
  })
  .strict();

export const PatchSettingsRequestSchema = z
  .object({
    baseRevision: z.number().int().positive(),
    patch: SettingsPatchSchema,
  })
  .strict();

export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;
export type SettingsDocument = z.infer<typeof SettingsDocumentSchema>;
export type PatchSettingsRequest = z.infer<
  typeof PatchSettingsRequestSchema
>;
