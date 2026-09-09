import { hasKnownEventTime, type Event } from "@musubi/types";

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
export function liveEventDetail(events: Event[], detail: Event | null, retiredGoogleEventIDs?: ReadonlySet<string>, retirementRevisions?: ReadonlyMap<string, number>): Event | null {
  if (!detail || isRetiredGoogleSnapshot(detail, retiredGoogleEventIDs, retirementRevisions)) return null;
  const live = events.find(e => e.id === detail.id);
  if (!live) return detail;
  if (!live.recurrence) return live;
  const refreshed = withOccurrenceTime(live, detail);
  // The displayed known occurrence still belongs to its original definition.
  // A time-scope planner must not treat old civil coordinates as a new revision.
  return hasKnownEventTime(detail) ? { ...refreshed, revision: detail.revision } : refreshed;
}

/** A fresh accepted row may reopen the identity; an older displayed occurrence
 * still belongs to the retired definition and must not silently revive. */
export function isRetiredGoogleSnapshot(event: Event, retired?: ReadonlySet<string>, revisions?: ReadonlyMap<string, number>) {
  return !!retired?.has(event.id) || !!revisions?.has(event.id) && (event.revision ?? 0) <= revisions.get(event.id)!;
}
