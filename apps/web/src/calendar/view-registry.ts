import type { Settings } from "@musubi/types";
import { getAgendaLabel, getAgendaRecurrenceEnd } from "./agenda-math";
import {
  addDays,
  addMonthPages,
  getMonthGridRange,
  startOfDay,
  startOfWeek,
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
export type ViewOptions = {
  /** The phone: the label drops the year before it drops the days. */
  compact?: boolean;
  weekStartsOn?: Settings["weekStartsOn"];
  /** Multi-week only — how many weeks the Page asks for. */
  weeks?: number;
};

export const DEFAULT_MULTI_WEEK_WEEKS = 4;
export const MAX_MULTI_WEEK_WEEKS = 20;

export type ViewDefinition = {
  /**
   * Kept out of the view switcher and the shortcut list, but still reachable by
   * URL and selectable in a Page config.
   *
   * For a view that exists and works but is not being offered yet — multi-week
   * is a concept we want to keep exercising (its tests run, the registry
   * contract covers it) without putting it in front of people mid-design.
   */
  hidden?: boolean;
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
  range: (anchor: Date, options?: ViewOptions) => { end: Date; start: Date };
  /** A horizontal swipe pages the period. The agenda scrolls instead. */
  swipeable: boolean;
  /** One screen forward (`offset` 1) or back (-1). */
  step: (anchor: Date, offset: number, options?: ViewOptions) => Date;
  /** What the toolbar calls the period in view. */
  title: (anchor: Date, options?: ViewOptions) => string;
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
    title: (anchor, { compact = false, weekStartsOn = "monday" } = {}) =>
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
    expandsRecurringOnly: false,
    id: "tasks",
    label: "Tasks",
    range: (anchor) => ({ end: addDays(startOfDay(anchor), 1), start: startOfDay(anchor) }),
    step: (anchor, offset) => addDays(anchor, offset),
    swipeable: false,
    title: () => "Tasks",
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
    title: (anchor, { compact = false } = {}) =>
      getAgendaLabel(anchor, { compact }),
  },
  {
    expandsRecurringOnly: false,
    hidden: true,
    id: "multi-week",
    label: "Weeks",
    range: (anchor, { weeks = DEFAULT_MULTI_WEEK_WEEKS } = {}) => {
      const days = multiWeekDays(anchor, "monday", weeks);

      return {
        // A day of padding either side, for the same reason Month has it: the
        // reader's week start is not known when the first read goes out.
        end: addDays(days[days.length - 1]!, 2),
        start: addDays(days[0]!, -1),
      };
    },
    // A screen at a time. Paging by one week would make twenty weeks unusable
    // to navigate, and the whole point of the view is the long view.
    step: (anchor, offset, { weeks = DEFAULT_MULTI_WEEK_WEEKS } = {}) =>
      addDays(anchor, offset * weeks * 7),
    swipeable: true,
    title: (
      anchor,
      { weekStartsOn = "monday", weeks = DEFAULT_MULTI_WEEK_WEEKS } = {},
    ) => multiWeekLabel(multiWeekDays(anchor, weekStartsOn, weeks)),
  },
];

/**
 * The exact days a multi-week screen shows: whole weeks from the one the anchor
 * falls in, running forward. Month boundaries are ignored on purpose — the view
 * exists to look past them.
 */
export function multiWeekDays(
  anchor: Date,
  weekStartsOn: Settings["weekStartsOn"],
  weeks: number,
): Date[] {
  const clamped = Math.min(
    MAX_MULTI_WEEK_WEEKS,
    Math.max(1, Math.round(weeks)),
  );
  const first = startOfWeek(anchor, weekStartsOn);

  return Array.from({ length: clamped * 7 }, (_, index) =>
    addDays(first, index),
  );
}

/** "Jul 20 – Oct 11" — two dates, and a year only when the span crosses one. */
function multiWeekLabel(days: Date[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return "";

  const sameYear = first.getFullYear() === last.getFullYear();
  // Short months even on a wide screen: a span is two dates, and "July 20 –
  // September 13 2026" is long enough that the toolbar clips it — which
  // answers nothing at all.
  const day = (date: Date, withMonth: boolean) =>
    new Intl.DateTimeFormat("en", {
      day: "numeric",
      ...(withMonth ? { month: "short" } : {}),
      // The year rides on the dates that need it, which is only when the span
      // crosses one. Inside a single year it is the least useful part of the
      // string and the first thing to push the label into an ellipsis.
      ...(sameYear ? {} : { year: "numeric" }),
    }).format(date);

  const head = day(first, first.getMonth() !== last.getMonth());
  const tail = day(last, true);

  return `${head} – ${tail}`;
}

export type CalendarViewId =
  | "agenda"
  | "day"
  | "month"
  | "multi-week"
  | "tasks"
  | "week";

export function isCalendarView(value: string): value is CalendarViewId {
  return calendarViews.some((view) => view.id === value);
}

/** The views a person can pick. Hidden ones stay reachable by URL. */
export const offeredViews = () => calendarViews.filter((view) => !view.hidden);

/** The definition behind a view id. Month is the fallback, as everywhere else. */
export function viewDefinition(id: string): ViewDefinition {
  return (
    calendarViews.find((view) => view.id === id) ??
    calendarViews.find((view) => view.id === "month")!
  );
}
