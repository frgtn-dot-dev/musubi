import { EventSchema, EventWriteError, type Event } from "@musubi/types";
import { finiteSeriesFootprint } from "./finite-series";

/** Parse only explicit DATE exclusions. No floating/zoned interpretation. */
export function allDayExclusionDates(recurrence: string | null | undefined): string[] | null {
  if (!recurrence || recurrence.length > 8192) return null;
  const [rule, ...lines] = recurrence.split("\n");
  if (!/^(?:RRULE:)?FREQ=[^\r\n]+$/.test(rule!) || !/(?:^|;)COUNT=[1-9]\d*(?:;|$)/.test(rule!)) return null;
  const dates: string[] = [];
  for (const line of lines) {
    const match = /^EXDATE;VALUE=DATE:([0-9,]+)$/.exec(line);
    if (!match) return null;
    for (const value of match[1]!.split(",")) {
      if (!/^\d{8}$/.test(value)) return null;
      const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
      const parsed = new Date(date + "T00:00:00Z");
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || dates.includes(date)) return null;
      dates.push(date);
    }
  }
  return dates.length <= 366 ? dates : null;
}

/** Keep the accepted RRULE and every remaining property/order unchanged. */
export function restoreAllDayExclusion(recurrence: string, date: string): string {
  const dates = allDayExclusionDates(recurrence);
  if (!dates?.includes(date)) throw new Error("Refresh this excluded date before restoring it.");
  const [rule, ...lines] = recurrence.split("\n");
  const literal = date.replace(/-/g, "");
  return [rule!, ...lines.flatMap(line => {
    const values = line.slice("EXDATE;VALUE=DATE:".length).split(",").filter(value => value !== literal);
    return values.length ? ["EXDATE;VALUE=DATE:" + values.join(",")] : [];
  })].join("\n");
}

/** Complete master proof: only removal of existing finite DATE slots. */
export function caldavExdateRestoration(master: Event, recurrence: string): string[] {
  const refuse = (): never => { throw new EventWriteError("event-write", "unsupported", "Restore excluded dates only from a finite personal all-day series without other changes or exceptions."); };
  try {
    master = EventSchema.parse(master);
    if (master.timeModel?.kind !== "all-day" || master.seriesID || master.originalStart || master.isCanceled) refuse();
    const before = allDayExclusionDates(master.recurrence), after = allDayExclusionDates(recurrence);
    if (!before?.length || !after || after.some(date => !before.includes(date))) return refuse();
    const removed = before.filter(date => !after.includes(date));
    if (!removed.length) refuse();
    let expected = master.recurrence!;
    for (const date of removed) expected = restoreAllDayExclusion(expected, date);
    if (expected !== recurrence) refuse();
    const slots = finiteSeriesFootprint({ ...master, recurrence: master.recurrence!.split("\n")[0]! });
    const known = new Set(slots.map(slot => slot.start.toISOString().slice(0, 10)));
    if (before.some(date => !known.has(date))) refuse();
    return removed;
  } catch { return refuse(); }
}
