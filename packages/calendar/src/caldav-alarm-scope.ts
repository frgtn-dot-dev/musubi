import { EventSchema, EventWriteError, type Event, type ProviderEventStateResponse } from "@musubi/types";
import { finiteSeriesFootprint, FINITE_SERIES_MAX_DAYS, FINITE_SERIES_MAX_OCCURRENCES } from "./finite-series";
import { expandRecurringEvents } from "./recurrence";
import { resolveEventTimeEdit } from "./time-edit";
import { unambiguousCivilToInstant } from "./time-zone";

function assertFiniteAlarmSeries(event: Event): void {
  const refuse = (): never => { throw new EventWriteError("event-write", "unsupported"); };
  const model = event.timeModel;
  if (model?.kind !== "zoned") { finiteSeriesFootprint(event); return; }
  const terms = event.recurrence!.replace(/^RRULE:/, "").split(";").map(term => term.split("="));
  if (new Set(terms.map(([name]) => name)).size !== terms.length || terms.some(term => term.length !== 2) || terms.some(([name]) => name === "UNTIL")) refuse();
  const count = Number(terms.find(([name]) => name === "COUNT")?.[1]);
  if (!Number.isSafeInteger(count) || count < 1 || count > FINITE_SERIES_MAX_OCCURRENCES) refuse();
  const span = FINITE_SERIES_MAX_DAYS * 86_400_000;
  const boundary = new Date(event.start.getTime() + span);
  // Independently enumerate civil starts so gaps cannot disappear or replenish
  // COUNT. DTEND defines an exact elapsed duration; an overnight civil boundary
  // is harmless when both actual endpoints remain unambiguous.
  const civil = { ...event, ...resolveEventTimeEdit({ kind: "floating", startLocal: model.startLocal, endLocal: model.endLocal }) };
  const raw = expandRecurringEvents([civil], civil.start, new Date(civil.start.getTime() + span), { consumerTimeZone: "UTC" });
  const actual = expandRecurringEvents([event], event.start, boundary, { consumerTimeZone: "UTC" });
  if (raw.length !== count || actual.length !== count) refuse();
  const starts = new Set<number>();
  for (const slot of raw) {
    if (slot.timeModel?.kind !== "floating") return refuse();
    const start = unambiguousCivilToInstant(slot.timeModel.startLocal, model.timeZone).getTime();
    if (starts.has(start)) refuse();
    starts.add(start);
  }
  for (const slot of actual) {
    if (slot.timeModel?.kind !== "zoned" || !starts.delete(slot.start.getTime()) || slot.start < event.start || slot.end <= slot.start || slot.end > boundary || slot.end.getTime() - slot.start.getTime() !== event.end.getTime() - event.start.getTime()) return refuse();
    if (unambiguousCivilToInstant(slot.timeModel.startLocal, model.timeZone).getTime() !== slot.start.getTime() || unambiguousCivilToInstant(slot.timeModel.endLocal, model.timeZone).getTime() !== slot.end.getTime()) refuse();
  }
  if (starts.size) refuse();
}

/** An explicit series request is required; absent scope keeps the one-off contract. */
export function caldavAlarmScope(input: Event): "series" | undefined {
  const event = EventSchema.parse(input);
  if (event.seriesID || event.originalStart || event.isCanceled || !["zoned", "all-day"].includes(event.timeModel?.kind ?? "")) throw new EventWriteError("event-write", "unsupported");
  if (!event.recurrence) return undefined;
  if (!/^(?:RRULE:)?FREQ=[^\r\n]+$/.test(event.recurrence) || !/(?:^|;)COUNT=[1-9]\d*(?:;|$)/.test(event.recurrence)) throw new EventWriteError("event-write", "unsupported");
  assertFiniteAlarmSeries(event);
  return "series";
}

/** A displayed/generated occurrence is never the master authorization context. */
export function assertCaldavSeriesAlarmObservation(master: Event, observation: ProviderEventStateResponse): void {
  if (caldavAlarmScope(master) !== "series" || observation.state?.provider !== "caldav" || !observation.version || observation.reminderEdit?.provider !== "caldav" || observation.reminderEdit.scope !== "series" || observation.reminderEdit.expectedRevision !== master.revision) throw new Error("Series alarm settings changed. Refresh the series before editing its alarm.");
}
