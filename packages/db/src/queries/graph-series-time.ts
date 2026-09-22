import { finiteSeriesFootprint, resolveEventTimeEdit } from "@musubi/calendar";
import { BadRequestError, EventSchema } from "@musubi/types";
import type { GraphOccurrenceContent } from "./graph-occurrence-content";
import type { GraphFamilyObservation } from "./graph-family";
import { sameCaldavScopeContext as same } from "./caldav-series-scope";

type Proof = Pick<GraphOccurrenceContent, "baseline" | "native" | "nativeExceptions" | "template">;
/** Graph's inclusive endDate has no clock. Its local RRULE projection uses the
 * master's UTC clock, which must move too without changing the native range. */
function seriesRecurrence(saved: Proof, start = new Date(saved.baseline.master.values.start)) {
  const recurrence = saved.baseline.master.values.recurrence;
  const native = saved.native.recurrence as { range?: { type?: string; endDate?: string } } | undefined;
  if (!recurrence) return undefined;
  if (native?.range?.type === "numbered") return recurrence;
  const endDate = native?.range?.endDate;
  if (native?.range?.type !== "endDate" || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return undefined;
  const day = new Date(`${endDate}T00:00:00Z`);
  const old = new Date(saved.baseline.master.values.start);
  if (!Number.isFinite(day.getTime()) || !Number.isFinite(old.getTime()) || !Number.isFinite(start.getTime()) || day.toISOString().slice(0, 10) !== endDate || old.getUTCMilliseconds() || start.getUTCMilliseconds()) return undefined;
  const cutoff = (clock: Date) => `${endDate.replace(/-/g, "")}T${clock.toISOString().slice(11, 19).replace(/:/g, "")}Z`;
  const terms = recurrence.split(";");
  const until = terms.filter(term => term.startsWith("UNTIL="));
  if (until.length !== 1 || until[0] !== `UNTIL=${cutoff(old)}`) return undefined;
  return terms.map(term => term.startsWith("UNTIL=") ? `UNTIL=${cutoff(start)}` : term).join(";");
}
/** Graph resets exceptions/cancellations on a master time edit. Only a plain,
 * fully observed UTC family with stable occurrence dates qualifies. */
export function graphSeriesTimeSupported(saved: Proof) {
  const { baseline, native, nativeExceptions } = saved;
  const master = baseline.master.values, model = master.timeModel;
  return seriesRecurrence(saved) !== undefined && model.kind === "zoned" && model.timeZone === "UTC" && !master.isAllDay &&
    model.startLocal.slice(0, 10) === model.endLocal.slice(0, 10) &&
    native.originalStartTimeZone === "UTC" && native.originalEndTimeZone === "UTC" &&
    nativeExceptions?.length === 0 && baseline.cancelled.length === 0 && baseline.instances.length > 0 &&
    baseline.instances.every(value => value.providerState.eventType === "occurrence" &&
      value.originalStart.kind === "instant" && !value.values.isAllDay &&
      same(value.providerState, { ...baseline.master.providerState, eventType: "occurrence" }));
}
export function graphSeriesTimeChange(saved: Proof & Pick<GraphOccurrenceContent, "request">) {
  const input = saved.request.patch.time;
  if (saved.request.scope !== "series" || !input) return undefined;
  const old = saved.baseline.master.values.timeModel;
  if (!graphSeriesTimeSupported(saved) || input.kind !== "zoned" || input.timeZone !== "UTC" || old.kind !== "zoned")
    throw new BadRequestError("Series time editing requires a verified finite UTC series without changed or cancelled occurrences.");
  if (input.startLocal.slice(0, 10) !== old.startLocal.slice(0, 10) || input.endLocal.slice(0, 10) !== old.endLocal.slice(0, 10))
    throw new BadRequestError("Keep the first occurrence's date when changing the series time.");
  const time = resolveEventTimeEdit(input);
  if (time.end <= time.start) throw new BadRequestError("The series must end after it starts.");
  const recurrence = seriesRecurrence(saved, time.start);
  if (!recurrence) throw new BadRequestError("Keep the verified recurrence end date and use whole-second series times.");
  const template = EventSchema.parse({ ...saved.template, ...saved.baseline.master.values, ...time, recurrence });
  const slots = finiteSeriesFootprint(template);
  if (slots.length !== saved.baseline.instances.length || slots.some((slot, i) =>
    slot.originalStart.value.slice(0, 10) !== saved.baseline.instances[i]?.originalStart.value.slice(0, 10)))
    throw new BadRequestError("Keep the existing occurrence dates and recurrence rule.");
  return { time, template, slots };
}
export function graphSeriesTimeObserved(saved: Proof & Pick<GraphOccurrenceContent, "request">, after: GraphFamilyObservation | null) {
  const desired = graphSeriesTimeChange(saved);
  if (!desired || !after || after.cancelled.length || after.instances.length !== saved.baseline.instances.length) return false;
  const { patch } = saved.request;
  const changed = desired.time.start.getTime() !== new Date(saved.baseline.master.values.start).getTime() ||
    desired.time.end.getTime() !== new Date(saved.baseline.master.values.end).getTime();
  const content = (value: GraphFamilyObservation["master"]) => {
    const { etag: _etag, ...rest } = value;
    return rest;
  };
  const compare = (before: GraphFamilyObservation["master"], next: GraphFamilyObservation["master"], time: typeof desired.time, originalStart?: GraphFamilyObservation["instances"][number]["originalStart"]) => {
    if (!next.etag) return false;
    // Only the verified empty RSVP reset is permitted; full native master
    // readback also checks each response timestamp and every extra guest field.
    const attendees = before.providerState.attendees.map((guest, index) => {
      const response = after.master.providerState.attendees[index]?.response;
      return changed && (response === "none" || response === "notResponded") ? { ...guest, response } : guest;
    });
    const values = { ...before.values, ...time,
      ...(!originalStart ? { recurrence: desired.template.recurrence } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
      ...(patch.location !== undefined ? { location: patch.location?.trim() || null } : {}),
    };
    return same(content(next), content({ ...before, values, providerState: { ...before.providerState, attendees }, ...(originalStart ? { originalStart } : {}) }));
  };
  return compare(saved.baseline.master, after.master, desired.time) && saved.baseline.instances.every((before, i) => {
    const next = after.instances.find(value => value.externalID === before.externalID), slot = desired.slots[i]!;
    return !!next && compare(before, next, { start: slot.start, end: slot.end, isAllDay: slot.isAllDay, timeModel: slot.timeModel! }, slot.originalStart);
  });
}
