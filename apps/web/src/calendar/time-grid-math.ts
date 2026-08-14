import type { Settings } from "@musubi/types";
import {
  addDays,
  startOfDay,
  startOfWeek,
} from "@musubi/calendar/layout";

export type TimeGridViewId = "day" | "week";

// ── Overlap placement tuning ────────────────────────────────────────────────
/**
 * How many overlap levels get a lane of their own. Deeper ones stack on the last
 * lane; z-order still puts the later event on top, so nothing is unreachable —
 * ponytail: a cluster deeper than this loses its fan, which is the point at which
 * a "+N more" affordance would earn its keep.
 */
const MAX_OVERLAP_LANES = 4;
/**
 * How far a block spreads past its own lane, as a multiple of the lane width.
 * 1 would be strict side-by-side columns; more than that lets a block cover part
 * of its right-hand neighbour, which is what makes two events read as one wide
 * card with a second card laid over its corner rather than two thin slivers.
 */
const LANE_SPREAD = 1.7;
/** Breathing room so neighbouring blocks never share an edge. */
const LANE_GAP_PX = 3;
/**
 * How far the rightmost block stays off the column's edge. Blocks that touch the
 * grid line read as part of it; the gap also leaves a strip of bare column to
 * press for a new event next to a full one.
 */
const COLUMN_RIGHT_INSET_PX = 10;

// ── Opening scroll position ─────────────────────────────────────────────────
/** Where a day without "now" on it opens: the start of a working day. */
const DEFAULT_OPEN_HOUR = 7;
/** How much of the recent past stays on screen when today is visible. */
const OPEN_PRE_ROLL_MINUTES = 60;

/**
 * Which minute of the day the time grid should open on.
 *
 * Landing on a fixed hour means that at 15:00 you open eight hours above your own
 * day and have to scroll to find it. When today is on screen the grid opens just
 * before now instead, which is what the native client does.
 */
export function openScrollMinutes(now: Date, includesToday: boolean): number {
  if (!includesToday) return DEFAULT_OPEN_HOUR * 60;
  return Math.max(0, now.getHours() * 60 - OPEN_PRE_ROLL_MINUTES);
}

export type OverlapPlacement = { left: string; width: string };

/**
 * Where an overlapping event sits across the width of its day column.
 *
 * Lanes are equal shares of the column, but each block spreads over part of the
 * next lane and paints above it (`zIndex` from the same `col`). So the earlier
 * event keeps a wide, readable strip instead of the 8px sliver a fixed-pixel
 * cascade leaves — the reference behaviour from Google Calendar, and the thing
 * `apps/client` will want too (it cascades by a fixed 10px today).
 */
export function overlapPlacement(
  col: number,
  cols: number,
): OverlapPlacement {
  const lanes = Math.max(1, Math.min(cols, MAX_OVERLAP_LANES));
  const lane = Math.min(col, lanes - 1);
  const share = 100 / lanes;
  const left = lane * share;
  const width = Math.min(100 - left, share * LANE_SPREAD);
  // Only the last lane's right edge is the column's edge; the others are covered
  // by the block that spreads over them, so they just need the lane gap.
  const trim = lane === lanes - 1 ? COLUMN_RIGHT_INSET_PX : LANE_GAP_PX;

  return {
    left: `${left}%`,
    width: `calc(${width}% - ${trim}px)`,
  };
}

export function getTimeGridDays(
  anchor: Date,
  view: TimeGridViewId,
  weekStartsOn: Settings["weekStartsOn"],
  // A page can hide the weekend to get a five-column working week.
  { includeWeekend = true }: { includeWeekend?: boolean } = {},
): Date[] {
  const start =
    view === "day"
      ? startOfDay(anchor)
      : startOfWeek(anchor, weekStartsOn);
  const length = view === "day" ? 1 : 7;
  const days = Array.from({ length }, (_, index) => addDays(start, index));

  // Filtered by actual weekday, so it holds for both week starts. A single day
  // is never dropped — the user navigated to it deliberately.
  return includeWeekend || view === "day"
    ? days
    : days.filter((day) => day.getDay() !== 0 && day.getDay() !== 6);
}

export function getTimeGridQueryRange(
  anchor: Date,
  view: TimeGridViewId,
) {
  if (view === "day") {
    const start = startOfDay(anchor);

    return { end: addDays(start, 1), start };
  }

  const mondayStart = startOfWeek(anchor, "monday");
  const sundayStart = startOfWeek(anchor, "sunday");
  const start =
    mondayStart.getTime() < sundayStart.getTime()
      ? mondayStart
      : sundayStart;
  const latestStart =
    mondayStart.getTime() > sundayStart.getTime()
      ? mondayStart
      : sundayStart;

  return {
    end: addDays(latestStart, 7),
    start,
  };
}

/**
 * The toolbar's period label. `compact` is the phone: the year is what the label
 * can lose first and still answer "which days am I looking at", and a truncated
 * label answers nothing at all.
 */
export function getTimeGridLabel(
  days: Date[],
  view: TimeGridViewId,
  { compact = false }: { compact?: boolean } = {},
): string {
  const first = days[0];
  const last = days[days.length - 1];

  if (!first || !last) {
    return "";
  }

  if (view === "day") {
    return new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: compact ? "short" : "long",
      weekday: compact ? "short" : "long",
      ...(compact ? {} : { year: "numeric" }),
    }).format(first);
  }

  const firstMonth = new Intl.DateTimeFormat("en", {
    month: "short",
  }).format(first);
  const lastMonth = new Intl.DateTimeFormat("en", {
    month: "short",
  }).format(last);

  // A week that straddles New Year keeps both years even when compact: that is
  // the one case where dropping them makes the range ambiguous.
  if (first.getFullYear() !== last.getFullYear()) {
    return `${firstMonth} ${first.getDate()}, ${first.getFullYear()} – ${lastMonth} ${last.getDate()}, ${last.getFullYear()}`;
  }

  const year = compact ? "" : `, ${last.getFullYear()}`;

  if (first.getMonth() === last.getMonth()) {
    return `${firstMonth} ${first.getDate()} – ${last.getDate()}${year}`;
  }

  return `${firstMonth} ${first.getDate()} – ${lastMonth} ${last.getDate()}${year}`;
}
