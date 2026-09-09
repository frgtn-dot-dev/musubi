import { CivilDateTimeSchema, EventTimeModelSchema, EventWriteError, OccurrenceStartSchema, type Event, type EventTimeModel, type OccurrenceStart, type OccurrenceIdentity } from "@musubi/types";
import { expandRecurringEvents } from "./recurrence";
import { EventExpansionError } from "./time-expansion";
import { resolveEventTimeEdit } from "./time-edit";
import { civilToInstant, instantToCivil, unambiguousCivilToInstant } from "./time-zone";

const DAY = 86_400_000;
export const FINITE_SERIES_MAX_OCCURRENCES = 366;
export const FINITE_SERIES_MAX_DAYS = 730;
export type FiniteSeriesOccurrence = {
  originalStart: OccurrenceStart;
  start: Date;
  end: Date;
  isAllDay: boolean;
  timeModel: Extract<EventTimeModel, { kind: "zoned" | "all-day" }>;
};
function refuse(): never {
  throw new EventWriteError("recurrence", "unsupported", "Outlook series creation requires 1–366 unambiguous occurrences with COUNT or UNTIL, wholly within 730 days. Timed occurrences must stay within one civil day with a fixed duration. No changes were saved.");
}

/** Inclusive native date boundary equivalent to the saved date/UTC UNTIL.
 * An instant before the scheduled civil start excludes that entire date. This
 * conversion alone does not prove the pattern or the complete finite family. */
export function recurrenceUntilEndDate(event: Event, until: string): string {
  const model = EventTimeModelSchema.parse(event.timeModel);
  let endDate: string;
  if (model.kind === "all-day") {
    if (!/^\d{8}$/.test(until)) refuse();
    endDate = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
  } else if (model.kind === "zoned") {
    if (!/^\d{8}T\d{6}Z$/.test(until)) refuse();
    const literal = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}T${until.slice(9, 11)}:${until.slice(11, 13)}:${until.slice(13, 15)}`;
    const instant = new Date(CivilDateTimeSchema.parse(literal) + "Z");
    endDate = instantToCivil(instant, model.timeZone).slice(0, 10);
    const start = civilToInstant(endDate + model.startLocal.slice(10), model.timeZone, "recurrence");
    if (!start) refuse();
    if (start > instant) endDate = new Date(Date.parse(endDate + "T00:00:00Z") - DAY).toISOString().slice(0, 10);
  } else return refuse();
  CivilDateTimeSchema.parse(endDate + "T00:00:00");
  const startDate = model.kind === "all-day" ? event.start.toISOString().slice(0, 10) : model.startLocal.slice(0, 10);
  if (endDate < startDate) refuse();
  return endDate;
}

/** Shared admission/ACK/import proof. Explicit finite termination prevents a
 * clipped horizon from being mistaken for a complete original-slot family.
 * Provider serializers must additionally prove their native pattern/range. */
export function finiteSeriesFootprint(event: Event): FiniteSeriesOccurrence[] {
  try {
    const model = EventTimeModelSchema.parse(event.timeModel);
    if (event.isCanceled || event.seriesID || event.originalStart || !["zoned", "all-day"].includes(model.kind)) refuse();
    const rawRule = event.recurrence?.trim().replace(/^RRULE:/i, "").toUpperCase();
    if (!rawRule || /[\r\n:]/.test(rawRule)) refuse();
    const terms = new Map<string, string>();
    for (const part of rawRule.split(";")) {
      const pair = /^([A-Z]+)=([^=]+)$/.exec(part);
      if (!pair || terms.has(pair[1]!)) refuse();
      terms.set(pair[1]!, pair[2]!);
    }
    const countText = terms.get("COUNT"), until = terms.get("UNTIL");
    if (!!countText === !!until) refuse();
    const count = countText ? Number(countText) : undefined;
    if (countText && (!/^[1-9]\d*$/.test(countText) || !Number.isSafeInteger(count) || count! > FINITE_SERIES_MAX_OCCURRENCES)) refuse();
    const boundary = new Date(event.start.getTime() + FINITE_SERIES_MAX_DAYS * DAY);
    let endDate: string | undefined;
    if (until) {
      endDate = recurrenceUntilEndDate(event, until);
      const cutoff = model.kind === "all-day" ? new Date(endDate + "T00:00:00Z") : new Date(`${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}T${until.slice(9, 11)}:${until.slice(11, 13)}:${until.slice(13, 15)}Z`);
      if (cutoff > boundary || cutoff < event.start) refuse();
    }
    const rawSlots = new Map<number, number>();
    if (model.kind === "zoned") {
      // Enumerate civil slots independently: neither skipped gaps nor COUNT
      // replenishment can hide an unsupported native occurrence. A UTC UNTIL
      // cannot be reused on a floating model; use its proven inclusive date.
      const civilRule = until ? rawRule.replace(/UNTIL=[^;]+/, `UNTIL=${endDate!.replace(/-/g, "")}T235959`) : rawRule;
      const civil = { ...event, recurrence: civilRule, ...resolveEventTimeEdit({ kind: "floating", startLocal: model.startLocal, endLocal: model.endLocal }) };
      const raw = expandRecurringEvents([civil], civil.start, new Date(civil.start.getTime() + FINITE_SERIES_MAX_DAYS * DAY), { consumerTimeZone: "UTC" });
      if (!raw.length || raw.length > FINITE_SERIES_MAX_OCCURRENCES || (count !== undefined && raw.length !== count)) refuse();
      for (const value of raw) {
        const slot = EventTimeModelSchema.parse(value.timeModel);
        if (slot.kind !== "floating") refuse();
        const start = unambiguousCivilToInstant(slot.startLocal, model.timeZone).getTime();
        const end = unambiguousCivilToInstant(slot.endLocal, model.timeZone).getTime();
        if (end - start !== event.end.getTime() - event.start.getTime() || rawSlots.has(start)) refuse();
        rawSlots.set(start, end);
      }
    }
    const values = expandRecurringEvents<Event & { occurrenceIdentity?: OccurrenceIdentity }>([event], event.start, boundary, { consumerTimeZone: "UTC" });
    if (!values.length || values.length > FINITE_SERIES_MAX_OCCURRENCES || (count !== undefined && values.length !== count) || (model.kind === "zoned" && rawSlots.size !== values.length)) refuse();
    const seen = new Set<string>();
    return values.map(value => {
      if (value.occurrenceIdentity?.seriesId !== event.id) refuse();
      const originalStart = OccurrenceStartSchema.parse(value.occurrenceIdentity.originalStart);
      const slot = EventTimeModelSchema.parse(value.timeModel);
      if (slot.kind !== "zoned" && slot.kind !== "all-day") refuse();
      const key = JSON.stringify(originalStart);
      if (seen.has(key) || value.start < event.start || value.end.getTime() + (value.isAllDay ? DAY : 0) > boundary.getTime() ||
          (slot.kind === "zoned" && (rawSlots.get(value.start.getTime()) !== value.end.getTime() || slot.startLocal.slice(0, 10) !== slot.endLocal.slice(0, 10) || value.end <= value.start || value.end.getTime() - value.start.getTime() !== event.end.getTime() - event.start.getTime()))) refuse();
      seen.add(key);
      return { originalStart, start: new Date(value.start.getTime()), end: new Date(value.end.getTime()), isAllDay: value.isAllDay, timeModel: slot };
    });
  } catch (error) {
    if (error instanceof EventExpansionError) throw error;
    return refuse();
  }
}
