import { EventSchema, EventWriteError, type Event } from "@musubi/types";
import { finiteSeriesFootprint } from "./finite-series";

const refuse = (): never => { throw new EventWriteError("recurrence", "unsupported", "Add or remove one additional date from a finite all-day series without other changes or exceptions."); };
function parts(recurrence: string | null | undefined) {
  if (!recurrence || recurrence.length > 8192) return refuse();
  const [rule, addition, ...rest] = recurrence.split("\n");
  if (!/^(?:RRULE:)?FREQ=[^\r\n]+$/.test(rule!) || !/(?:^|;)COUNT=[1-9]\d*(?:;|$)/.test(rule!) || rest.length) return refuse();
  let date: string | undefined;
  if (addition !== undefined) {
    const match = /^RDATE;VALUE=DATE:(\d{8})$/.exec(addition);
    if (!match) return refuse();
    const value = match[1]!;
    date = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
    if (!Number.isFinite(new Date(date + "T00:00:00Z").getTime()) || new Date(date + "T00:00:00Z").toISOString().slice(0,10) !== date) return refuse();
  }
  return { rule: rule!, date };
}
/** Full stored master proof. Never substitute a displayed occurrence anchor. */
export function allDayAdditionalDate(master: Event): { date?: string; rule: string; limit: string } {
  master = EventSchema.parse(master);
  if (master.timeModel?.kind !== "all-day" || master.seriesID || master.originalStart || master.isCanceled || master.hasAttendees) return refuse();
  const parsed = parts(master.recurrence);
  const slots = finiteSeriesFootprint({ ...master, recurrence: parsed.rule });
  const limit = new Date(master.start.getTime() + 730 * 86400000).toISOString().slice(0,10);
  if (parsed.date && (parsed.date <= master.start.toISOString().slice(0,10) || parsed.date >= limit || Date.parse(parsed.date + "T00:00:00Z") + master.end.getTime() - master.start.getTime() >= Date.parse(limit + "T00:00:00Z") || slots.length >= 366 || slots.some(slot => slot.start.toISOString().slice(0,10) === parsed.date))) return refuse();
  return { ...parsed, limit };
}
export function setAllDayAdditionalDate(master: Event, date: string | null): string {
  const current = allDayAdditionalDate(master);
  const next = date === null ? current.rule : `${current.rule}\nRDATE;VALUE=DATE:${date.replace(/-/g, "")}`;
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return refuse();
  allDayAdditionalDate({ ...master, recurrence: next });
  return next;
}
/** Only an exact single add/remove delta; RRULE and its COUNT anchor stay fixed. */
export function caldavRdateEdit(master: Event, recurrence: string): { before?: string; after?: string } {
  const before = allDayAdditionalDate(master), after = allDayAdditionalDate({ ...master, recurrence });
  if (before.rule !== after.rule || before.date === after.date || !!before.date === !!after.date) return refuse();
  if (setAllDayAdditionalDate(master, after.date ?? null) !== recurrence) return refuse();
  return { before: before.date, after: after.date };
}
