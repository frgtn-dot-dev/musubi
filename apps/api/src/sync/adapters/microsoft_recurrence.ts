import { civilToInstant, instantToCivil } from "@musubi/calendar";
import { CivilDateTimeSchema, EventTimeModelSchema, EventWriteError, type Event } from "@musubi/types";

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
    let endDate: string;
    if (model.kind === "all-day") {
      if (!/^\d{8}$/.test(rule.UNTIL)) return unsupported("All-day UNTIL must be a date.");
      endDate = `${rule.UNTIL.slice(0, 4)}-${rule.UNTIL.slice(4, 6)}-${rule.UNTIL.slice(6, 8)}`;
    } else {
      if (!/^\d{8}T\d{6}Z$/.test(rule.UNTIL)) return unsupported("Zoned UNTIL must be a UTC instant.");
      const until = new Date(`${rule.UNTIL.slice(0, 4)}-${rule.UNTIL.slice(4, 6)}-${rule.UNTIL.slice(6, 8)}T${rule.UNTIL.slice(9, 11)}:${rule.UNTIL.slice(11, 13)}:${rule.UNTIL.slice(13, 15)}Z`);
      const literal = `${rule.UNTIL.slice(0, 4)}-${rule.UNTIL.slice(4, 6)}-${rule.UNTIL.slice(6, 8)}T${rule.UNTIL.slice(9, 11)}:${rule.UNTIL.slice(11, 13)}:${rule.UNTIL.slice(13, 15)}`;
      if (!CivilDateTimeSchema.safeParse(literal).success || !Number.isFinite(until.getTime())) return unsupported("Invalid UNTIL.");
      endDate = instantToCivil(until, model.timeZone).slice(0, 10);
      // Graph endDate is inclusive. An UNTIL before that day's start must
      // exclude the entire day, even when UTC and event-zone dates differ.
      const candidate = civilToInstant(endDate + model.startLocal.slice(10), model.timeZone, "recurrence");
      if (!candidate) return unsupported("UNTIL intersects an unresolved DST gap.");
      if (candidate > until) endDate = new Date(Date.parse(endDate + "T00:00Z") - 86400000).toISOString().slice(0, 10);
    }
    const parsed = new Date(endDate + "T00:00:00Z");
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== endDate || endDate < startDate) return unsupported("UNTIL precedes the master or is invalid.");
    range.type = "endDate"; range.endDate = endDate;
  }
  return { pattern, range };
}
