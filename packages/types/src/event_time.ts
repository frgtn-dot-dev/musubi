import { z } from "zod";

// Offset-free civil timestamps are values, never implicitly parsed in the host TZ.
export const CivilDateTimeSchema = z.iso
  .datetime({ local: true })
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value),
    "Expected a civil timestamp without an offset, with at most millisecond precision",
  )
  .transform((value) => {
    const [seconds, fraction = ""] = value.split(".");
    return `${seconds}.${fraction.padEnd(3, "0")}`;
  });
export const EventTimeZoneSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => {
    // Intl also accepts numeric offsets in newer engines; those are not IANA zones.
    if (/^[+-]/.test(value)) return false;
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Unsupported time zone");

export const EventTimeModelSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("legacy-unknown") }).strict(),
  z.object({ kind: z.literal("all-day") }).strict(),
  z
    .object({
      kind: z.literal("zoned"),
      timeZone: EventTimeZoneSchema,
      // Preserve civil anchors: a gap's resolved instant round-trips to a
      // different wall clock, which must not become the recurrence anchor.
      startLocal: CivilDateTimeSchema,
      endLocal: CivilDateTimeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("floating"),
      startLocal: CivilDateTimeSchema,
      endLocal: CivilDateTimeSchema,
    })
    .strict()
    .refine((value) => value.startLocal <= value.endLocal, {
      message: "Floating end must not precede start",
    }),
]);
export type EventTimeModel = z.infer<typeof EventTimeModelSchema>;

// Identity is the ORIGINAL start, independently of the exception's moved time.
export const OccurrenceStartSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("instant"),
      value: z.iso
        .datetime()
        .refine(
          (value) => !/\.\d{4}/.test(value),
          "At most millisecond precision",
        )
        .transform((value) => new Date(value).toISOString()),
    })
    .strict(),
  z
    .object({ kind: z.literal("floating"), value: CivilDateTimeSchema })
    .strict(),
  z.object({ kind: z.literal("date"), value: z.iso.date() }).strict(),
]);
export type OccurrenceStart = z.infer<typeof OccurrenceStartSchema>;

export const OccurrenceIdentitySchema = z
  .object({
    seriesId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    originalStart: OccurrenceStartSchema,
  })
  .strict();
export type OccurrenceIdentity = z.infer<typeof OccurrenceIdentitySchema>;

/** A transport-independent key; the moved start/end are deliberately absent. */
export function occurrenceKey(identity: OccurrenceIdentity): string {
  const parsed = OccurrenceIdentitySchema.parse(identity);
  return JSON.stringify([
    parsed.seriesId,
    parsed.originalStart.kind,
    parsed.originalStart.value,
  ]);
}
