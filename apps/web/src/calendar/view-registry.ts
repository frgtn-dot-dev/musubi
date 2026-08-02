import type { Settings } from "@musubi/types";
import { getAgendaLabel, getAgendaRecurrenceEnd } from "./agenda-math";
import {
  addDays,
  addMonthPages,
  getMonthGridRange,
  startOfDay,
} from "@musubi/calendar/layout";
import { getMonthLabel } from "./calendar-math";
import {
  getTimeGridDays,
  getTimeGridLabel,
  getTimeGridQueryRange,
} from "./time-grid-math";

/**
 * What every calendar view has to answer.
 *
 * The point is that a new view is a new entry here, not a new branch in five
 * files. Before this, "which range do I query", "how far does an arrow move",
 * "what does the toolbar say" and "does a swipe page it" were `if (view === …)`
 * chains in Workspace and workspace-queries — so adding a fifth view meant
 * editing the other four's code paths, which `PRD §16.2` explicitly forbids.
 *
 * The JSX that draws a view stays a switch in Workspace on purpose: putting
 * components here would pull the whole view tree into every module that only
 * wants to know a keyboard shortcut or validate a URL segment.
 */
export type ViewDefinition = {
  /**
   * Agenda expands only the recurring events and keeps the rest as they are —
   * it is a forward-looking list, not a window. Every other view expands
   * everything inside its range.
   */
  expandsRecurringOnly: boolean;
  id: string;
  label: string;
  /**
   * The window to query and expand recurrence over.
   *
   * Deliberately independent of `weekStartsOn`: the first read starts before
   * settings have loaded, so the range covers both week starts rather than
   * waiting to learn which one applies.
   */
  range: (anchor: Date) => { end: Date; start: Date };
  /** A horizontal swipe pages the period. The agenda scrolls instead. */
  swipeable: boolean;
  /** One screen forward (`offset` 1) or back (-1). */
  step: (anchor: Date, offset: number) => Date;
  /** What the toolbar calls the period in view. */
  title: (
    anchor: Date,
    options: { compact: boolean; weekStartsOn: Settings["weekStartsOn"] },
  ) => string;
};

function timeGridView(
  id: "day" | "week",
  label: string,
  days: number,
): ViewDefinition {
  return {
    expandsRecurringOnly: false,
    id,
    label,
    range: (anchor) => getTimeGridQueryRange(anchor, id),
    step: (anchor, offset) => addDays(anchor, offset * days),
    swipeable: true,
    title: (anchor, { compact, weekStartsOn }) =>
      getTimeGridLabel(getTimeGridDays(anchor, id, weekStartsOn), id, {
        compact,
      }),
  };
}

export const calendarViews: ViewDefinition[] = [
  timeGridView("day", "Day", 1),
  timeGridView("week", "Week", 7),
  {
    expandsRecurringOnly: false,
    id: "month",
    label: "Month",
    range: (anchor) => {
      const grid = getMonthGridRange(anchor, "monday", 1);

      // One day of padding either side covers a Sunday-first reader too.
      return { end: grid.endExclusive, start: grid.start };
    },
    step: (anchor, offset) => addMonthPages(anchor, offset),
    swipeable: true,
    title: (anchor) => getMonthLabel(anchor),
  },
  {
    expandsRecurringOnly: true,
    id: "agenda",
    label: "Agenda",
    range: (anchor) => {
      const start = startOfDay(anchor);

      return { end: getAgendaRecurrenceEnd(start), start };
    },
    // The agenda runs forward from a day, so a page is a month of reading.
    step: (anchor, offset) => addMonthPages(anchor, offset),
    swipeable: false,
    title: (anchor, { compact }) => getAgendaLabel(anchor, { compact }),
  },
];

export type CalendarViewId = "agenda" | "day" | "month" | "week";

export function isCalendarView(value: string): value is CalendarViewId {
  return calendarViews.some((view) => view.id === value);
}

/** The definition behind a view id. Month is the fallback, as everywhere else. */
export function viewDefinition(id: string): ViewDefinition {
  return (
    calendarViews.find((view) => view.id === id) ??
    calendarViews.find((view) => view.id === "month")!
  );
}
