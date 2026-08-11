import type { Event } from "@musubi/types";
import { assignSpanLanes, eventDayKeys } from "@musubi/calendar/layout";
import { shiftDayKey, toDateKey } from "./date-key";
import type { PollCalendarItem } from "./components/PollCalendarChip";

export type CalendarLaneSpan =
  | {
      durationDays: number;
      endCol: number;
      event: Event;
      id: string;
      kind: "event";
      lane: number;
      startCol: number;
    }
  | {
      durationDays: number;
      endCol: number;
      id: string;
      items: PollCalendarItem[];
      kind: "poll";
      lane: number;
      startCol: number;
    };

function visibleRange(keys: string[], columns: Map<string, number>) {
  const visible = keys
    .map((key) => columns.get(key))
    .filter((column): column is number => column !== undefined);
  return visible.length
    ? { endCol: Math.max(...visible), startCol: Math.min(...visible) }
    : undefined;
}

export function visibleLaneLimit(laneCount: number, capacity: number) {
  return laneCount > capacity ? Math.max(0, capacity - 1) : capacity;
}

/** Stable interval lanes for one visible week. Poll gaps form separate runs. */
export function calendarLaneSpans(
  events: Event[],
  pollItems: PollCalendarItem[],
  days: Date[],
  includeTimed = false,
): CalendarLaneSpan[] {
  const columns = new Map(days.map((day, index) => [toDateKey(day), index]));
  const spans: CalendarLaneSpan[] = [];
  const seenEvents = new Set<string>();

  for (const event of events) {
    if ((!event.isAllDay && !includeTimed) || seenEvents.has(event.id)) continue;
    seenEvents.add(event.id);
    const keys = event.isAllDay
      ? eventDayKeys(event, 3660)
      : [toDateKey(event.start)];
    const range = visibleRange(keys, columns);
    if (!range) continue;
    spans.push({
      ...range,
      durationDays: keys.length,
      event,
      id: `event:${event.id}`,
      kind: "event",
      lane: 0,
    });
  }

  const polls = new Map<string, PollCalendarItem[]>();
  for (const item of pollItems) {
    const items = polls.get(item.poll.id);
    if (items) items.push(item);
    else polls.set(item.poll.id, [item]);
  }

  for (const [pollId, items] of polls) {
    const byDate = new Map(items.map((item) => [item.date, item]));
    const dates = [...byDate.keys()].sort();
    let run: string[] = [];

    const addRun = () => {
      const range = visibleRange(run, columns);
      if (range) {
        spans.push({
          ...range,
          durationDays: run.length,
          id: `poll:${pollId}:${run[0]}`,
          items: run.flatMap((date) => {
            const item = byDate.get(date);
            return item ? [item] : [];
          }),
          kind: "poll",
          lane: 0,
        });
      }
      run = [];
    };

    for (const date of dates) {
      if (run.length && shiftDayKey(run[run.length - 1]!, 1) !== date) addRun();
      run.push(date);
    }
    addRun();
  }

  return assignSpanLanes(spans, (left, right) => {
    const duration = right.durationDays - left.durationDays;
    if (duration) return duration;
    if (left.kind !== right.kind) return left.kind === "event" ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
}
