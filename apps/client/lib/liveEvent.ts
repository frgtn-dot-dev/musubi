import { type Event } from "@musubi/types";

/** Keep the occurrence's temporal tuple together when taking live content from
 * its stored definition. Its civil anchors are not the master's anchors.
 */
export function withOccurrenceTime(definition: Event, occurrence: Event): Event {
  return {
    ...definition,
    start: occurrence.start,
    end: occurrence.end,
    isAllDay: occurrence.isAllDay,
    timeModel: occurrence.timeModel,
  };
}

// The open detail modal holds a snapshot; SSE keeps the store fresh. Read the
// live row so remote edits (links, renames, …) show without a reload. For
// recurring events keep the tapped occurrence's start/end (the store row
// carries the series master's times).
export function liveEventDetail(events: Event[], detail: Event | null): Event | null {
  if (!detail) return null;
  const live = events.find(e => e.id === detail.id);
  if (!live) return detail;
  return live.recurrence ? withOccurrenceTime(live, detail) : live;
}
