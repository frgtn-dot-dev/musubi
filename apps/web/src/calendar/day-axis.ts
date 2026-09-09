/** Renderer-free, minute-resolution axis for modern civil calendar days.
 * Coordinates are physical minute rows, never an ambiguous HH:MM value.
 * No browser-local timezone, Date#setHours normalization, or persisted cache.
 */
export type CivilMinute = { key: string; minute: number; fold: number };
export type DayMinute = CivilMinute & { instant: number; offsetMinutes: number };
export type DayAxis = { date: string; timezone: string; start: number; end: number; minutes: DayMinute[] };
export type TimeAxis = { rows: CivilMinute[]; days: DayAxis[]; columns: (DayMinute | null)[][] };
const MINUTE = 60_000;
function civilDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Expected a civil YYYY-MM-DD date");
  const anchor = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(anchor) || new Date(anchor).toISOString().slice(0, 10) !== date) throw new Error("Invalid civil date");
  return anchor;
}
export function buildDayAxis(date: string, timezone: string): DayAxis {
  const anchor = civilDate(date);
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const minutes: DayMinute[] = [], counts = new Map<number, number>();
  // A bounded UTC window covers every current IANA offset and a date-line day.
  // Minute granularity intentionally refuses historical sub-minute offsets.
  for (let instant = anchor - 36 * 60 * MINUTE; instant < anchor + 60 * 60 * MINUTE; instant += MINUTE) {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` !== date) continue;
    if (parts.second !== "00") throw new Error("Historical sub-minute offsets are unsupported");
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    const fold = counts.get(minute) ?? 0; counts.set(minute, fold + 1);
    const offsetMinutes = (anchor + minute * MINUTE - instant) / MINUTE;
    minutes.push({ key: `${minute}/${fold}`, minute, fold, instant, offsetMinutes });
  }
  if (!minutes.length) throw new Error("This civil date does not exist in the selected timezone");
  if (minutes.some((value, index) => index > 0 && value.instant !== minutes[index - 1]!.instant + MINUTE)) throw new Error("Non-contiguous civil date is unsupported");
  return { date, timezone, start: minutes[0]!.instant, end: minutes[minutes.length - 1]!.instant + MINUTE, minutes };
}
/** One day has precisely its elapsed length: 23/25 and half-hour changes work alike. */
export function singleDayAxis(day: DayAxis): TimeAxis {
  return { rows: day.minutes, days: [day], columns: [day.minutes] };
}
/** A week shares civil rows, preserving each column's chronological ordering.
 * Repeated blocks are inserted as complete blocks, never minute-by-minute folds.
 * A hole has no instant and must not be an actionable create/drop target.
 */
export function sharedWeekAxis(days: DayAxis[]): TimeAxis {
  if (!days.length || days.length > 7 || days.some(day => day.timezone !== days[0]!.timezone) || new Set(days.map(day => day.date)).size !== days.length) throw new Error("Expected one to seven unique days in one timezone");
  const values = new Map<string, CivilMinute>(), edges = new Map<string, Set<string>>(), incoming = new Map<string, number>();
  for (const day of days) for (const value of day.minutes) { values.set(value.key, value); incoming.set(value.key, 0); edges.set(value.key, new Set()); }
  for (const day of days) for (let index = 1; index < day.minutes.length; index++) {
    const before = day.minutes[index - 1]!.key, after = day.minutes[index]!.key;
    if (!edges.get(before)!.has(after)) { edges.get(before)!.add(after); incoming.set(after, incoming.get(after)! + 1); }
  }
  const ready = [...values.keys()].filter(key => incoming.get(key) === 0), rows: CivilMinute[] = [];
  while (ready.length) {
    ready.sort((a, b) => values.get(a)!.minute - values.get(b)!.minute || values.get(a)!.fold - values.get(b)!.fold);
    const key = ready.shift()!; rows.push(values.get(key)!);
    for (const next of edges.get(key)!) { incoming.set(next, incoming.get(next)! - 1); if (incoming.get(next) === 0) ready.push(next); }
  }
  if (rows.length !== values.size) throw new Error("Civil axes cannot share a chronological row order");
  return { rows, days, columns: days.map(day => { const byKey = new Map(day.minutes.map(value => [value.key, value])); return rows.map(row => byKey.get(row.key) ?? null); }) };
}
export function coordinateToInstant(axis: TimeAxis, column: number, coordinate: number): number | null {
  if (!Number.isFinite(coordinate) || coordinate < 0 || coordinate >= axis.rows.length) return null;
  const value = axis.columns[column]?.[Math.floor(coordinate)];
  // Date instants have millisecond precision. Undo floating point division
  // without turning epoch +59ms into +58.99999999999999ms.
  return value ? Math.min(value.instant + MINUTE - 1, Math.round(value.instant + (coordinate % 1) * MINUTE)) : null;
}
export function instantToCoordinate(axis: TimeAxis, column: number, instant: number): number | null {
  const day = axis.days[column];
  if (!day || !Number.isFinite(instant) || instant < day.start || instant >= day.end) return null;
  const value = day.minutes[Math.floor((instant - day.start) / MINUTE)]!;
  const row = axis.rows.findIndex(item => item.key === value.key);
  return row < 0 ? null : row + (instant - value.instant) / MINUTE;
}
/** Missing civil minutes return []; repeated minutes return both exact candidates. */
export function civilCandidates(day: DayAxis, minute: number): DayMinute[] {
  return day.minutes.filter(value => value.minute === minute);
}
/** Clip a real interval to a column and split at holes, preserving elapsed duration. */
export function intervalAxisSegments(axis: TimeAxis, column: number, start: number, end: number): { start: number; end: number }[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const segments: { start: number; end: number }[] = [];
  axis.columns[column]?.forEach((value, row) => {
    if (!value) return;
    const from = Math.max(start, value.instant), until = Math.min(end, value.instant + MINUTE);
    if (until <= from) return;
    const segment = { start: row + (from - value.instant) / MINUTE, end: row + (until - value.instant) / MINUTE };
    const previous = segments[segments.length - 1];
    if (previous?.end === segment.start) previous.end = segment.end; else segments.push(segment);
  });
  return segments;
}
export function civilMinuteLabel(value: CivilMinute): string { return `${String(Math.floor(value.minute / 60)).padStart(2, "0")}:${String(value.minute % 60).padStart(2, "0")}`; }
export function utcOffsetLabel(minutes: number): string { return `UTC${minutes < 0 ? "−" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`; }
/** Resize ends may land on a real minute's exclusive edge, including day end.
 * At the edge of a hole, start and end intentionally resolve different sides.
 */
export function coordinateBoundaryInstant(axis: TimeAxis, column: number, coordinate: number, edge: "start" | "end"): number | null {
  if (edge === "start" || !Number.isInteger(coordinate)) return coordinateToInstant(axis, column, coordinate);
  if (coordinate <= 0 || coordinate > axis.rows.length) return null;
  const previous = axis.columns[column]?.[coordinate - 1];
  return previous ? previous.instant + MINUTE : null;
}
