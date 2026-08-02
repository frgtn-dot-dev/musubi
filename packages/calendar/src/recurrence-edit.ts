import { endSeriesBefore, excludeOccurrence, remainderRule } from "./recurrence";

export type EditScope = "occurrence" | "following" | "series";

/**
 * What the three scopes need from an event. Generic so each client keeps its own
 * event type through the call — this package stays free of the type package and
 * of any renderer.
 */
export type SeriesEditable = {
  end: Date;
  id: string;
  recurrence?: string | null;
  start: Date;
};

export type SeriesEdit<T> = {
  /** New events to add — a detached occurrence or the split-off series. */
  creates: T[];
  /** Existing events to write, in order. Run these before the creates. */
  updates: T[];
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
export function seriesEditWrites<T extends SeriesEditable>({
  edited,
  master,
  newId = () => crypto.randomUUID(),
  occurrence,
  scope,
}: {
  edited: T;
  master: T;
  /**
   * Id for an event a split creates. Defaults to `crypto.randomUUID`, which the
   * browser has; React Native brings its own generator.
   */
  newId?: () => string;
  occurrence: SeriesEditable;
  scope: EditScope;
}): SeriesEdit<T> {
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
    return seriesEditWrites({
      edited,
      master,
      newId,
      occurrence,
      scope: "series",
    });
  }

  const detached = { ...edited, id: newId() };

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
