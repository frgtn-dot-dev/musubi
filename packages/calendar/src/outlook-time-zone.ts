import { Temporal } from "@js-temporal/polyfill";
import { CivilDateTimeSchema, EventTimeZoneSchema } from "@musubi/types";
import { OUTLOOK_WINDOWS_ZONES } from "./outlook-windows-zones";

/** Alias equivalence, never equivalence of today's UTC offsets. */
export function canonicalTimeZone(value: unknown): string | undefined {
  if (!EventTimeZoneSchema.safeParse(value).success) return undefined;
  return new Intl.DateTimeFormat("en", { timeZone: value as string }).resolvedOptions().timeZone;
}

export function outlookWindowsZone(value: unknown) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(OUTLOOK_WINDOWS_ZONES, value) ? OUTLOOK_WINDOWS_ZONES[value] : undefined;
}

/** A Windows zone can cover several territories. Membership is only candidate
 * evidence: the complete native finite family must still match our expansion. */
export function outlookTimeZoneMatches(label: unknown, timeZone: string): boolean {
  const canonical = canonicalTimeZone(timeZone);
  if (!canonical || typeof label !== "string") return false;
  const windows = outlookWindowsZone(label);
  return windows ? windows.zones.some(zone => canonicalTimeZone(zone) === canonical) : canonicalTimeZone(label) === canonical;
}

/** Prefer explicit IANA authoring evidence. Windows-only events use CLDR's 001
 * representative, not the viewer's country/zone and not a guess at location.
 * A saved zone is a comparison constraint, never permission to reinterpret an
 * explicitly different IANA zone. Unknown/custom/mixed labels fail closed. */
export function outlookSeriesTimeZone(labels: {
  recurrenceTimeZone?: unknown; originalStartTimeZone?: unknown; originalEndTimeZone?: unknown;
}, savedZone?: string): string | undefined {
  const values = [labels.originalStartTimeZone, labels.originalEndTimeZone, labels.recurrenceTimeZone];
  if (values.some(value => typeof value !== "string" || !value)) return undefined;
  const explicit = values.filter(value => canonicalTimeZone(value)) as string[];
  const zone = savedZone ?? explicit[0] ?? outlookWindowsZone(values[2])?.default;
  if (!zone || !canonicalTimeZone(zone) || !values.every(label => outlookTimeZoneMatches(label, zone))) return undefined;
  // Two distinct Windows rules can share regional candidates; that is not
  // evidence that their authoring semantics are interchangeable.
  const windows = values.filter(value => outlookWindowsZone(value));
  if (new Set(windows).size > 1) return undefined;
  return zone;
}

export function outlookEndpointZonesMatch(native: Record<string, unknown>, timeZone: string) {
  return outlookSeriesTimeZone({ ...native, recurrenceTimeZone: timeZone }, timeZone) !== undefined;
}

/** Civil-minute arithmetic deliberately does not cross a DST change by adding
 * elapsed milliseconds. The caller must resolve both endpoints unambiguously. */
export function shiftCivilMinutes(civil: string, minutes: number): string {
  if (!Number.isSafeInteger(minutes)) throw new RangeError("Expected whole minutes");
  return CivilDateTimeSchema.parse(Temporal.PlainDateTime.from(CivilDateTimeSchema.parse(civil)).add({ minutes }).toString({ fractionalSecondDigits: 3 }));
}
