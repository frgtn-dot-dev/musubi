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
 * The writes that apply one occurrence's edit at the chosen scope.
 *
 * `edited` is that occurrence as the user left it — new times from a drag, new
 * content from the form, or both. `occurrence` is where it stood before, which
 * is what the exclusion stamp and the whole-series shift are measured from.
 *
 * Kept as data rather than as calls so the caller decides how to run and how to
 * undo them, and so each scope can be checked without a server.
 */
export function seriesEditWrites({
  edited,
  master,
  occurrence,
  scope,
}: {
  edited: Event;
  master: Event;
  occurrence: Event;
  scope: EditScope;
}): SeriesEdit {
  if (!master.recurrence || scope === "series") {
    // The series takes the new content, but only *shifts* by what this
    // occurrence moved: setting the master to the occurrence's own dates would
    // drag the whole series onto this one date.
    const startShift = edited.start.getTime() - occurrence.start.getTime();
    const endShift = edited.end.getTime() - occurrence.end.getTime();
    return {
      creates: [],
      updates: [
        {
          ...edited,
          end: new Date(master.end.getTime() + endShift),
          id: master.id,
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
    return seriesEditWrites({ edited, master, occurrence, scope: "series" });
  }

  const detached = { ...edited, id: crypto.randomUUID() };

  if (scope === "occurrence") {
    return {
      creates: [{ ...detached, recurrence: null }],
      updates: [
        {
          ...master,
          recurrence: excludeOccurrence(master.recurrence, occurrence.start),
        },
      ],
    };
  }

  return {
    creates: [
      {
        ...detached,
        // A rule the user rewrote in the form is taken at face value; an
        // untouched one is carried over with its remaining count. Compared
        // against the occurrence, which is the rule the form was seeded from —
        // the master's may already differ from what was on screen.
        recurrence:
          edited.recurrence && edited.recurrence !== occurrence.recurrence
            ? edited.recurrence
            : remainderRule(
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
