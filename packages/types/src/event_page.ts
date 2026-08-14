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
    palette: z
      .enum(["sand", "ink", "moss", "harbour", "plum"])
      .default("sand"),
  })
  .strict();

export type EventPageTheme = z.infer<typeof EventPageThemeSchema>;

export const defaultEventPageTheme: EventPageTheme =
  EventPageThemeSchema.parse({});
