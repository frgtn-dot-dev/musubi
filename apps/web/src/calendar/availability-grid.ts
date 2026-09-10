import { buildDayAxis, singleDayAxis, intervalAxisSegments, type TimeAxis } from "./day-axis";
import { addDays, dayKey, startOfDay } from "@musubi/calendar/layout";
import type { AvailabilityResponse, AvailabilitySource } from "@musubi/types";
export type GridAvailabilityInterval = { sourceId: string; label: string; start: string; end: string };
export function isAvailabilityGridDay(day: Date) {
  const start = startOfDay(day), end = addDays(start, 1);
  return end.getTime() - start.getTime() === 86400000 && start.getTimezoneOffset() === end.getTimezoneOffset();
}
export function availabilityDaySegments(intervals: GridAvailabilityInterval[], day: Date, axis?: TimeAxis, column = 0) {
  const resolvedAxis = axis ?? singleDayAxis(buildDayAxis(dayKey(day), Intl.DateTimeFormat().resolvedOptions().timeZone));
  return intervals.flatMap(interval => intervalAxisSegments(resolvedAxis, column, Date.parse(interval.start), Date.parse(interval.end)).map(piece => ({ kind: "availability" as const, interval, startMin: piece.start, endMin: piece.end, col: 0, cols: 1 })));
}
export function currentAvailabilityResult(result: AvailabilityResponse, sources: AvailabilitySource[], start: string, end: string) {
  return Date.parse(result.start) === Date.parse(start) && Date.parse(result.end) === Date.parse(end)
    && result.sources.length === sources.length && new Set(result.sources.map(item => item.sourceId)).size === sources.length
    && result.sources.every(item => sources.some(source => source.id === item.sourceId && source.generation === item.generation));
}
