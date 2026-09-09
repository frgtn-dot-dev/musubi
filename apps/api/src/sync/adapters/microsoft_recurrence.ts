import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { civilToInstant, recurrenceUntilEndDate } from "@musubi/calendar";
import { CivilDateTimeSchema, EventTimeModelSchema, EventWriteError, type Event } from "@musubi/types";
import { graphTimeForEvent } from "./microsoft_time";

const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const tokens = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const indices = { "1": "first", "2": "second", "3": "third", "4": "fourth", "-1": "last" } as const;
export type GraphRecurrence = {
  pattern: { type: "daily" | "weekly" | "absoluteMonthly" | "relativeMonthly" | "absoluteYearly" | "relativeYearly"; interval: number; daysOfWeek?: string[]; firstDayOfWeek?: string; dayOfMonth?: number; month?: number; index?: string };
  range: { type: "numbered" | "endDate" | "noEnd"; startDate: string; recurrenceTimeZone?: string; numberOfOccurrences?: number; endDate?: string };
};
const unsupported = (detail: string): never => { throw new EventWriteError("recurrence", "unsupported", `${detail} The original rule was preserved. No changes were saved.`); };
const positive = (value: string | undefined, fallback?: number) => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!value || !/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) return unsupported("Outlook requires a positive 32-bit recurrence value.");
  return Number(value);
};

/** Pure candidate conversion only. Enabling Graph writes additionally requires
 * master echo deduplication, durable scope delivery and conditional-write proof.
 * No DTSTART/EXDATE/RDATE or unknown RRULE term is silently discarded.
 */
export function graphRecurrenceForEvent(event: Event): GraphRecurrence {
  graphTimeForEvent(event);
  const model = EventTimeModelSchema.parse(event.timeModel);
  if (model.kind === "legacy-unknown" || model.kind === "floating" || event.seriesID || event.originalStart || !event.recurrence) return unsupported("Outlook recurrence needs an explicit zoned or all-day master.");
  const raw = event.recurrence.trim().replace(/^RRULE:/i, "").toUpperCase();
  if (/[\r\n:]/.test(raw)) return unsupported("Outlook cannot represent this recurrence property set.");
  const allowed = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS", "WKST"]);
  const rule: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const pair = /^([A-Z]+)=([^=]+)$/.exec(part);
    if (!pair || !allowed.has(pair[1]!) || rule[pair[1]!] !== undefined) return unsupported("Outlook cannot represent this recurrence term.");
    rule[pair[1]!] = pair[2]!;
  }
  if (rule.COUNT && rule.UNTIL) return unsupported("Recurrence cannot contain both COUNT and UNTIL.");
  const startDate = model.kind === "all-day" ? event.start.toISOString().slice(0, 10) : model.startLocal.slice(0, 10);
  const anchor = new Date(startDate + "T00:00:00Z");
  const interval = positive(rule.INTERVAL, 1);
  const byDay = rule.BYDAY?.split(",");
  let pattern: GraphRecurrence["pattern"];
  const noTerms = (...names: string[]) => { if (names.some(name => rule[name] !== undefined)) unsupported("Outlook cannot represent this combination of recurrence terms."); };
  if (rule.FREQ === "DAILY") {
    noTerms("BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS", "WKST");
    pattern = { type: "daily", interval };
  } else if (rule.FREQ === "WEEKLY") {
    noTerms("BYMONTHDAY", "BYMONTH", "BYSETPOS");
    const days = byDay ?? [tokens[anchor.getUTCDay()]!];
    if (days.some(day => !tokens.includes(day)) || new Set(days).size !== days.length || !days.includes(tokens[anchor.getUTCDay()]!)) return unsupported("The weekly pattern must include its original start day.");
    const wkst = rule.WKST ?? "MO";
    if (!tokens.includes(wkst)) return unsupported("Invalid week start.");
    pattern = { type: "weekly", interval, daysOfWeek: days.map(day => weekdays[tokens.indexOf(day)]!), firstDayOfWeek: weekdays[tokens.indexOf(wkst)]! };
  } else if (rule.FREQ === "MONTHLY" || rule.FREQ === "YEARLY") {
    noTerms("WKST");
    const yearly = rule.FREQ === "YEARLY";
    if (yearly && !rule.BYMONTH && (rule.BYMONTHDAY || rule.BYDAY || rule.BYSETPOS)) return unsupported("Yearly day filters require an explicit month for this converter.");
    if (!yearly) noTerms("BYMONTH");
    const month = yearly ? positive(rule.BYMONTH, anchor.getUTCMonth() + 1) : undefined;
    if (month !== undefined && (month > 12 || month !== anchor.getUTCMonth() + 1)) return unsupported("The yearly pattern must include its original start month.");
    if (byDay) {
      noTerms("BYMONTHDAY");
      // Graph's multiple-weekday relative pattern is not an arbitrary BYDAY set.
      // Start with one weekday so ordinal semantics remain unambiguous.
      if (byDay.length !== 1) return unsupported("Multiple relative weekdays are not supported by this converter.");
      const match = /^(-?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(byDay[0]!);
      if (!match || (match[1] && rule.BYSETPOS)) return unsupported("Invalid relative weekday.");
      const ordinal = match[1] ?? rule.BYSETPOS;
      const index = indices[ordinal as keyof typeof indices];
      if (!index || tokens[anchor.getUTCDay()] !== match[2]) return unsupported("Outlook cannot represent this relative weekday.");
      const day = anchor.getUTCDate();
      const last = new Date(anchor.getTime() + 7 * 86400000).getUTCMonth() !== anchor.getUTCMonth();
      if (ordinal === "-1" ? !last : Math.floor((day - 1) / 7) + 1 !== Number(ordinal)) return unsupported("The relative pattern must include its original start.");
      pattern = { type: yearly ? "relativeYearly" : "relativeMonthly", interval, daysOfWeek: [weekdays[tokens.indexOf(match[2]!)]!], index, ...(yearly ? { month } : {}) };
    } else {
      noTerms("BYSETPOS");
      const day = positive(rule.BYMONTHDAY, anchor.getUTCDate());
      // Month-end clamping differs between recurrence engines; do not claim
      // RFC skipping semantics for Outlook's short months without proof.
      if (day !== anchor.getUTCDate() || day > 28) return unsupported("Month-end recurrence requires explicit provider verification.");
      pattern = { type: yearly ? "absoluteYearly" : "absoluteMonthly", interval, dayOfMonth: day, ...(yearly ? { month } : {}) };
    }
  } else return unsupported("Outlook cannot represent this recurrence frequency.");
  const range: GraphRecurrence["range"] = { type: "noEnd", startDate, ...(model.kind === "zoned" ? { recurrenceTimeZone: model.timeZone } : {}) };
  if (rule.COUNT) { range.type = "numbered"; range.numberOfOccurrences = positive(rule.COUNT); }
  if (rule.UNTIL) {
    range.type = "endDate";
    range.endDate = recurrenceUntilEndDate(event, rule.UNTIL);
  }
  return { pattern, range };
}


const nativePatternSchema = z.object({
  type: z.enum(["daily", "weekly", "absoluteMonthly", "relativeMonthly", "absoluteYearly", "relativeYearly"]),
  interval: z.number().int().positive().max(2147483647),
  dayOfMonth: z.number().int().min(0).max(31).optional(),
  daysOfWeek: z.array(z.enum(weekdays)).optional(),
  firstDayOfWeek: z.enum(weekdays).optional(),
  index: z.enum(["first", "second", "third", "fourth", "last"]).optional(),
  month: z.number().int().min(0).max(12).optional(),
}).strict();
const nativeRangeSchema = z.object({
  type: z.enum(["numbered", "endDate", "noEnd"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  numberOfOccurrences: z.number().int().min(0).max(2147483647).optional(),
  recurrenceTimeZone: z.string().optional(),
}).strict();
const nativeRecurrenceSchema = z.object({ pattern: nativePatternSchema, range: nativeRangeSchema }).strict();

/** A native recurrence candidate for an independently verified master time.
 * This does not promote calendarView instances into locally expanded series.
 * Unknown semantics fail closed, leaving the existing provider-expanded import
 * available. Creation delivery must additionally prove identity and echo dedup.
 */
export function recurrenceFromGraph(event: Event, native: unknown): string {
  const parsed = nativeRecurrenceSchema.safeParse(native);
  const model = EventTimeModelSchema.parse(event.timeModel);
  if (!parsed.success || (model.kind !== "all-day" && model.kind !== "zoned") || event.seriesID || event.originalStart)
    return unsupported("Outlook native recurrence needs a known master and a complete supported pattern.");
  if (event.isAllDay !== (model.kind === "all-day")) return unsupported("The native master time kind is inconsistent.");
  const { pattern, range } = parsed.data;
  const zoned = model.kind === "zoned";
  const anchor = zoned ? model.startLocal.slice(0, 10) : event.start.toISOString().slice(0, 10);
  if (range.startDate !== anchor) return unsupported("The native recurrence range does not start at the accepted master.");
  // No Windows/IANA guessing or viewer-zone fallback. Missing range zone uses
  // the independently proven event zone, as specified by the Graph contract.
  if (range.recurrenceTimeZone && range.recurrenceTimeZone !== (zoned ? model.timeZone : "UTC"))
    return unsupported("The native recurrence zone differs from the accepted master.");
  const weekly = pattern.type === "weekly";
  const relative = pattern.type === "relativeMonthly" || pattern.type === "relativeYearly";
  const absolute = pattern.type === "absoluteMonthly" || pattern.type === "absoluteYearly";
  const yearly = pattern.type === "absoluteYearly" || pattern.type === "relativeYearly";
  // Graph can serialize inactive default fields. Accept only their neutral
  // values; a future/nondefault field must never disappear during conversion.
  if ((!absolute && pattern.dayOfMonth) || (!yearly && pattern.month) ||
    (!weekly && !relative && pattern.daysOfWeek?.length) ||
    (!weekly && pattern.firstDayOfWeek && pattern.firstDayOfWeek !== "sunday") ||
    (!relative && pattern.index && pattern.index !== "first"))
    return unsupported("The native pattern contains unsupported inactive fields.");
  if ((range.type !== "numbered" && range.numberOfOccurrences) ||
    (range.type !== "endDate" && range.endDate && range.endDate !== "0001-01-01"))
    return unsupported("The native range contains unsupported inactive fields.");
  const frequency = weekly ? "WEEKLY" : yearly ? "YEARLY" : absolute || relative ? "MONTHLY" : "DAILY";
  const terms = [`FREQ=${frequency}`, `INTERVAL=${pattern.interval}`];
  const normalizedPattern: GraphRecurrence["pattern"] = { type: pattern.type, interval: pattern.interval };
  if (weekly || relative) {
    const days = pattern.daysOfWeek;
    if (!days?.length || new Set(days).size !== days.length || (relative && days.length !== 1))
      return unsupported("The native weekday set cannot be represented without changing its meaning.");
    normalizedPattern.daysOfWeek = [...days];
    if (weekly) {
      const first = pattern.firstDayOfWeek ?? "sunday";
      normalizedPattern.firstDayOfWeek = first;
      terms.push(`BYDAY=${days.map(day => tokens[weekdays.indexOf(day)]).join(",")}`, `WKST=${tokens[weekdays.indexOf(first)]}`);
    } else {
      const index = pattern.index ?? "first";
      normalizedPattern.index = index;
      const ordinal = Object.entries(indices).find(([, name]) => name === index)![0];
      terms.push(`BYDAY=${ordinal}${tokens[weekdays.indexOf(days[0]!)]}`);
    }
  }
  if (absolute) {
    if (!pattern.dayOfMonth) return unsupported("The native monthly day is missing.");
    normalizedPattern.dayOfMonth = pattern.dayOfMonth;
    terms.push(`BYMONTHDAY=${pattern.dayOfMonth}`);
  }
  if (yearly) {
    if (!pattern.month) return unsupported("The native yearly month is missing.");
    normalizedPattern.month = pattern.month;
    terms.push(`BYMONTH=${pattern.month}`);
  }
  const normalizedRange: GraphRecurrence["range"] = { type: range.type, startDate: range.startDate, ...(zoned ? { recurrenceTimeZone: model.timeZone } : {}) };
  if (range.type === "numbered") {
    if (!range.numberOfOccurrences) return unsupported("The native recurrence count is missing.");
    normalizedRange.numberOfOccurrences = range.numberOfOccurrences;
    terms.push(`COUNT=${range.numberOfOccurrences}`);
  } else if (range.type === "endDate") {
    const endDate = range.endDate;
    if (!endDate || !CivilDateTimeSchema.safeParse(`${endDate}T00:00:00`).success || endDate < anchor)
      return unsupported("The native recurrence end date is invalid.");
    normalizedRange.endDate = endDate;
    if (zoned) {
      // RRULE instances keep the master's wall-clock start. A cutoff at that
      // start on the inclusive final date includes exactly the same instances.
      const end = civilToInstant(endDate + model.startLocal.slice(10), model.timeZone, "recurrence");
      if (!end || end.getUTCMilliseconds()) return unsupported("The native end date has no exact recurrence cutoff.");
      terms.push(`UNTIL=${end.toISOString().replace(/[-:]/g, "").replace(".000", "")}`);
    } else terms.push(`UNTIL=${endDate.replace(/-/g, "")}`);
  }
  const recurrence = `RRULE:${terms.join(";")}`;
  // Reuse the forward converter's anchor membership, month-end and relative
  // weekday restrictions. Both directions must describe precisely one shape.
  if (!isDeepStrictEqual(graphRecurrenceForEvent({ ...event, recurrence }), { pattern: normalizedPattern, range: normalizedRange }))
    return unsupported("The native recurrence cannot be represented losslessly.");
  return recurrence;
}
