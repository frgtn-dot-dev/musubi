import { Temporal } from "@js-temporal/polyfill";
import { CivilDateTimeSchema, EventTimeZoneSchema } from "@musubi/types";

/** Render an instant as civil fields in an explicit event/consumer zone. */
export function instantToCivil(instant: Date, timeZone: string): string {
  const zone = EventTimeZoneSchema.parse(timeZone);
  const value = Temporal.Instant.fromEpochMilliseconds(instant.getTime())
    .toZonedDateTimeISO(zone)
    .toPlainDateTime()
    .toString({ smallestUnit: "millisecond" });
  return CivilDateTimeSchema.parse(value);
}

/**
 * RFC5545 3.3.5: explicit gap times use the pre-transition offset; folds use
 * their first occurrence. Generated recurrences instead omit gaps (3.3.10).
 * Temporal resolves transitions using timezone data, including non-hour gaps.
 */
export function civilToInstant(
  civil: string,
  timeZone: string,
  source: "explicit" | "recurrence",
): Date | null {
  const value = Temporal.PlainDateTime.from(CivilDateTimeSchema.parse(civil));
  const zone = EventTimeZoneSchema.parse(timeZone);
  const resolved = value.toZonedDateTime(zone, {
    disambiguation: "compatible",
  });
  if (source === "recurrence" && !resolved.toPlainDateTime().equals(value))
    return null;
  return new Date(resolved.epochMilliseconds);
}

/** For provider contracts which do not prove how a gap or fold is resolved. */
export function unambiguousCivilToInstant(civil: string, timeZone: string): Date {
  const value = Temporal.PlainDateTime.from(CivilDateTimeSchema.parse(civil));
  const zone = EventTimeZoneSchema.parse(timeZone);
  return new Date(value.toZonedDateTime(zone, { disambiguation: "reject" }).epochMilliseconds);
}
