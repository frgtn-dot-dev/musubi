import { z } from "zod";

// How a published event page may look. A closed set, deliberately: `PRD §17.3`
// allows an organizer to choose a look and forbids arbitrary CSS or JavaScript,
// and enumerating the options is how that is enforced rather than asked for.
// The values themselves (and the proof that every palette is legible) live in
// `@musubi/design-system`; this is the wire contract for choosing one.
export const EventPageThemeSchema = z
  .object({
    cover: z.enum(["none", "wash", "grid"]).default("none"),
    font: z.enum(["serif", "sans"]).default("serif"),
    layout: z.enum(["classic", "poster"]).default("classic"),
    palette: z.enum(["sand", "ink", "moss", "harbour", "plum"]).default("sand"),
  })
  .strict();

export type EventPageTheme = z.infer<typeof EventPageThemeSchema>;

export const defaultEventPageTheme: EventPageTheme = EventPageThemeSchema.parse(
  {},
);

export const EventPageAgendaItemSchema = z
  .object({
    description: z.string().trim().max(240).default(""),
    id: z.string().min(1).max(64),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    title: z.string().trim().min(1).max(120),
  })
  .strict();

export const EventPageContentSchema = z
  .object({
    agenda: z
      .array(EventPageAgendaItemSchema)
      .max(20)
      .refine((items) => new Set(items.map((item) => item.id)).size === items.length)
      .default([]),
    cover: z
      .object({
        focalX: z.number().min(0).max(100).default(50),
        focalY: z.number().min(0).max(100).default(50),
        source: z.enum(["preset", "upload"]).default("preset"),
      })
      .strict()
      .default({ focalX: 50, focalY: 50, source: "preset" }),
    tags: z
      .array(z.string().trim().min(1).max(24))
      .max(6)
      .refine((tags) => new Set(tags).size === tags.length)
      .default([]),
  })
  .strict();

export type EventPageContent = z.infer<typeof EventPageContentSchema>;
export type EventPageAgendaItem = z.infer<typeof EventPageAgendaItemSchema>;

export const defaultEventPageContent: EventPageContent =
  EventPageContentSchema.parse({});
