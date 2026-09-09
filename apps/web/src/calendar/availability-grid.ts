import { addDays, startOfDay } from "@musubi/calendar/layout";
import type { AvailabilityResponse, AvailabilitySource } from "@musubi/types";
export type GridAvailabilityInterval = { sourceId: string; label: string; start: string; end: string };
export function isAvailabilityGridDay(day: Date) {
  const start = startOfDay(day), end = addDays(start, 1);
  return end.getTime() - start.getTime() === 86400000 && start.getTimezoneOffset() === end.getTimezoneOffset();
}
export function availabilityDaySegments(intervals: GridAvailabilityInterval[], day: Date) {
  if (!isAvailabilityGridDay(day)) return [];
  const min = startOfDay(day).getTime(), max = addDays(startOfDay(day), 1).getTime();
  return intervals.flatMap(interval => {
    const start = Math.max(min, Date.parse(interval.start)), end = Math.min(max, Date.parse(interval.end));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return [];
    return [{ kind: "availability" as const, interval, startMin: (start - min) / 60000, endMin: (end - min) / 60000, col: 0, cols: 1 }];
  });
}
export function currentAvailabilityResult(result: AvailabilityResponse, sources: AvailabilitySource[], start: string, end: string) {
  return Date.parse(result.start) === Date.parse(start) && Date.parse(result.end) === Date.parse(end)
    && result.sources.length === sources.length && new Set(result.sources.map(item => item.sourceId)).size === sources.length
    && result.sources.every(item => sources.some(source => source.id === item.sourceId && source.generation === item.generation));
}
