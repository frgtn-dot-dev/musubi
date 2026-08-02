import { z } from "zod";

// A Page is a private per-user calendar view profile: name, chosen view,
// visible calendars and simple filters. It links to shared data but is never
// itself shared — two members of the same calendar keep independent Pages.
// The config is stored as versioned JSONB; unknown future fields on an old
// client must round-trip untouched, so writers never silently drop them.

// A calendar id is an opaque reference here, not a trust boundary: reads ignore
// calendars the user can't access, and calendar endpoints validate real ids. A
// bounded string keeps the config robust without coupling it to the uuid format.
const CalendarIdSchema = z.string().min(1).max(128);

export const CalendarVisibilitySchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("all"),
      // `all` shows every accessible calendar; new ones appear automatically,
      // explicitly hidden ones stay hidden.
      hiddenCalendarIds: z.array(CalendarIdSchema).max(500),
    })
    .strict(),
  z
    .object({
      mode: z.literal("include"),
      // `include` is the power-user "Work" page: a new calendar never shows up
      // until the Page is edited.
      calendarIds: z.array(CalendarIdSchema).max(500),
    })
    .strict(),
]);

// Page icons are a closed set, not free text: the client maps the value to a
// component, so an arbitrary string in stored config would be a lookup miss (or
// worse) rather than a picture. Adding a name here is a contract change, which
// is the point — both clients have to know how to draw it.
export const PAGE_ICONS = [
  "house",
  "calendar-days",
  "star",
  "sparkles",
  "circle",
  "diamond",
  "heart",
  "plane",
  "coffee",
  "flag",
  "music",
  "briefcase",
] as const;

// Optional, not defaulted: "no icon chosen yet" is a real state for every Page
// stored before icons existed, and the client draws those the way it always did
// (a house for the default Page, a calendar for the rest).
export const PageIconSchema = z.enum(PAGE_ICONS).optional();

export type PageIcon = (typeof PAGE_ICONS)[number];

const DayViewSchema = z
  .object({
    id: z.literal("day"),
    configVersion: z.literal(1),
    // Three steps: two don't cover the spread of monitors, working hours and
    // eyesight (see docs/ui/calendar-ui.md).
    density: z
      .enum(["compact", "comfortable", "spacious"])
      .default("comfortable"),
  })
  .strict();

const WeekViewSchema = z
  .object({
    id: z.literal("week"),
    configVersion: z.literal(1),
    weekend: z.boolean().default(true),
    // Three steps: two don't cover the spread of monitors, working hours and
    // eyesight (see docs/ui/calendar-ui.md).
    density: z
      .enum(["compact", "comfortable", "spacious"])
      .default("comfortable"),
  })
  .strict();

const MonthViewSchema = z
  .object({
    id: z.literal("month"),
    configVersion: z.literal(1),
    showAdjacentDays: z.boolean().default(true),
  })
  .strict();

const AgendaViewSchema = z
  .object({
    id: z.literal("agenda"),
    configVersion: z.literal(1),
    groupBy: z.literal("day").default("day"),
  })
  .strict();

// Long-range planning: a run of whole weeks that ignores month boundaries. The
// count lives on the Page rather than in global settings — a "planning" page
// wants eight weeks and a "today" page wants one, and that is a property of the
// page, not of the person.
const MultiWeekViewSchema = z
  .object({
    id: z.literal("multi-week"),
    configVersion: z.literal(1),
    // Twenty is the reference app's ceiling and about where a week row stops
    // being able to show anything; one is a legitimate "just this week".
    weeks: z.number().int().min(1).max(20).default(4),
  })
  .strict();

export const BuiltInViewConfigSchema = z.discriminatedUnion("id", [
  DayViewSchema,
  WeekViewSchema,
  MonthViewSchema,
  AgendaViewSchema,
  MultiWeekViewSchema,
]);

export type BuiltInViewConfig = z.infer<typeof BuiltInViewConfigSchema>;
export type PageViewId = BuiltInViewConfig["id"];

export const PageFilterSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("attendance"),
      value: z.enum(["all", "attending", "not-attending"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("time"),
      value: z.enum(["all", "timed", "all-day"]),
    })
    .strict(),
]);

export const PageConfigV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    icon: PageIconSchema,
    view: BuiltInViewConfigSchema,
    calendarVisibility: CalendarVisibilitySchema,
    filters: z.array(PageFilterSchema).max(20).default([]),
  })
  .strict();

export const PageDocumentSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    position: z.number().int().nonnegative(),
    isDefault: z.boolean(),
    config: PageConfigV1Schema,
    revision: z.number().int().positive(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .strict();

export const CreatePageRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    config: PageConfigV1Schema,
  })
  .strict();

export const SavePageRequestSchema = z
  .object({
    baseRevision: z.number().int().positive(),
    name: z.string().trim().min(1).max(80),
    config: PageConfigV1Schema,
  })
  .strict();

export const ReorderPagesRequestSchema = z
  .object({
    // Full ordered id list; position is the array index. An optional default
    // moves the isDefault flag atomically in the same write.
    pageIds: z.array(z.string().uuid()).min(1).max(100),
    defaultPageId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine(({ defaultPageId, pageIds }, context) => {
    if (new Set(pageIds).size !== pageIds.length) {
      context.addIssue({
        code: "custom",
        message: "Page order must not contain duplicate ids.",
        path: ["pageIds"],
      });
    }
    if (defaultPageId && !pageIds.includes(defaultPageId)) {
      context.addIssue({
        code: "custom",
        message: "The default page must be included in the page order.",
        path: ["defaultPageId"],
      });
    }
  });

export type PageConfigV1 = z.infer<typeof PageConfigV1Schema>;
export type PageDocument = z.infer<typeof PageDocumentSchema>;
export type CreatePageRequest = z.infer<typeof CreatePageRequestSchema>;
export type SavePageRequest = z.infer<typeof SavePageRequestSchema>;
export type ReorderPagesRequest = z.infer<typeof ReorderPagesRequestSchema>;

// The default Page shows all calendars in the user's default view. Kept as a
// factory so both new-user init and the lazy backfill build the same document.
export function defaultPageConfig(view: PageViewId): PageConfigV1 {
  const viewConfig = BuiltInViewConfigSchema.parse(
    view === "week"
      ? { id: "week", configVersion: 1 }
      : view === "day"
        ? { id: "day", configVersion: 1 }
        : view === "agenda"
          ? { id: "agenda", configVersion: 1 }
          : view === "multi-week"
            ? { id: "multi-week", configVersion: 1 }
            : { id: "month", configVersion: 1 },
  );
  return {
    schemaVersion: 1,
    // This factory only builds the home Page; other pages pick their own.
    icon: "house",
    view: viewConfig,
    calendarVisibility: { mode: "all", hiddenCalendarIds: [] },
    filters: [],
  };
}
