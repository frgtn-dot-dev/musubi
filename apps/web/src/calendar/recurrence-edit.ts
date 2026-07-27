import type { Event } from "@musubi/types";
import {
  endSeriesBefore,
  excludeOccurrence,
  remainderRule,
} from "@musubi/calendar";

export type EditScope = "occurrence" | "following" | "series";

export type SeriesEdit = {
  /** New events to add — a detached occurrence or the split-off series. */
  creates: Event[];
  /** Existing events to write, in order. Run these before the creates. */
  updates: Event[];
};

/**
 * The writes that move or resize one occurrence of a series to [start, end].
 *
 * Kept as data rather than as calls so the caller decides how to run and how to
 * undo them, and so each scope can be checked without a server.
 */
export function seriesEditWrites({
  end,
  master,
  occurrence,
  scope,
  start,
}: {
  end: Date;
  master: Event;
  occurrence: Event;
  scope: EditScope;
  start: Date;
}): SeriesEdit {
  if (!master.recurrence || scope === "series") {
    // The series shifts by what the dragged occurrence moved; a resize changes
    // only the edge that moved, so the two shifts are tracked separately.
    const startShift = start.getTime() - occurrence.start.getTime();
    const endShift = end.getTime() - occurrence.end.getTime();
    return {
      creates: [],
      updates: [
        {
          ...master,
          end: new Date(master.end.getTime() + endShift),
          start: new Date(master.start.getTime() + startShift),
        },
      ],
    };
  }

  // Nothing precedes the first occurrence, so splitting there is the whole
  // series moving.
  if (
    scope === "following" &&
    occurrence.start.getTime() <= master.start.getTime()
  ) {
    return seriesEditWrites({
      end,
      master,
      occurrence,
      scope: "series",
      start,
    });
  }

  const detached = { ...master, end, id: crypto.randomUUID(), start };

  return scope === "occurrence"
    ? {
        creates: [{ ...detached, recurrence: null }],
        updates: [
          {
            ...master,
            recurrence: excludeOccurrence(master.recurrence, occurrence.start),
          },
        ],
      }
    : {
        creates: [
          {
            ...detached,
            recurrence: remainderRule(
              master.recurrence,
              master.start,
              occurrence.start,
            ),
          },
        ],
        updates: [
          {
            ...master,
            recurrence: endSeriesBefore(master.recurrence, occurrence.start),
          },
        ],
      };
}
