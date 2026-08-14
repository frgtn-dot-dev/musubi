import type { PageConfigV1 } from "@musubi/types";

// The single source of geometric truth for the time grid.
//
// Grid lines, event boxes, hit-testing and (later) drag/resize must all read
// these numbers. When they diverge the cursor drifts against the time it is
// pointing at — the classic calendar bug. Keeping it pure also lets the maths be
// tested without a DOM.

export type Density = "compact" | "comfortable" | "spacious";

export type TimeGeometry = {
  /** Height of one hour row, in px. */
  hourHeight: number;
  /** Shortest event that still stays clickable, in px. */
  minEventHeight: number;
  pxPerMinute: number;
  /** Grid-relative minute a pointer/drag snaps to. */
  snapMinutes: number;
  visibleDayEndMinutes: number;
  visibleDayStartMinutes: number;
};

const MINUTES_PER_DAY = 24 * 60;

// Three steps, because two are not enough for the spread of monitors, working
// hours and eyesight the reference study calls out.
const HOUR_HEIGHT_BY_DENSITY: Record<Density, number> = {
  compact: 44,
  comfortable: 64,
  spacious: 88,
};

export function createTimeGeometry(
  density: Density = "comfortable",
): TimeGeometry {
  const hourHeight = HOUR_HEIGHT_BY_DENSITY[density];

  return {
    hourHeight,
    // Small enough to read a 15-minute event, large enough to stay a target.
    minEventHeight: 20,
    pxPerMinute: hourHeight / 60,
    snapMinutes: 15,
    visibleDayEndMinutes: MINUTES_PER_DAY,
    visibleDayStartMinutes: 0,
  };
}

/** Density a page asks for. Only the time-grid views carry the field. */
export function densityFromPageConfig(
  config: PageConfigV1 | undefined,
): Density {
  const view = config?.view;
  // Deliberately not gated on the active view matching `view.id`: "this page
  // shows time grids compactly" is what a user means, whether they are looking
  // at the day or the week right now.
  return view && "density" in view ? view.density : "comfortable";
}

export function minutesToY(minutes: number, geometry: TimeGeometry): number {
  return (minutes - geometry.visibleDayStartMinutes) * geometry.pxPerMinute;
}

export function durationToHeight(
  durationMinutes: number,
  geometry: TimeGeometry,
): number {
  return Math.max(
    geometry.minEventHeight,
    durationMinutes * geometry.pxPerMinute,
  );
}

/**
 * Convert a grid-relative offset back to a minute of the day.
 *
 * `snap` is on by default because every creation and drag target should land on
 * the same lattice the grid draws.
 */
export function yToMinutes(
  y: number,
  geometry: TimeGeometry,
  { snap = true }: { snap?: boolean } = {},
): number {
  const raw =
    geometry.visibleDayStartMinutes + y / geometry.pxPerMinute;
  const snapped = snap
    ? Math.round(raw / geometry.snapMinutes) * geometry.snapMinutes
    : raw;

  // Clamp so a pointer dragged past either edge still yields a valid start:
  // the last slot must leave room for one snap interval.
  return Math.max(
    geometry.visibleDayStartMinutes,
    Math.min(geometry.visibleDayEndMinutes - geometry.snapMinutes, snapped),
  );
}

/** Total scrollable height of the grid. */
export function gridHeight(geometry: TimeGeometry): number {
  return (
    (geometry.visibleDayEndMinutes - geometry.visibleDayStartMinutes) *
    geometry.pxPerMinute
  );
}
