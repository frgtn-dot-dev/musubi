import { shiftDayKey } from "./date-key";
import type { TimeGeometry } from "./time-geometry";

// The maths behind dragging and resizing an event, kept out of the DOM so the
// rules (snap, clamping, minimum duration, day boundaries) are testable.
//
// Times are minutes from midnight of the event's own day; the day itself moves
// separately, via `dayOffset`.

export type DragMode = "move" | "resize-start" | "resize-end";

export type DragTimes = {
  endMinutes: number;
  startMinutes: number;
};

function snapTo(minutes: number, geometry: TimeGeometry): number {
  return Math.round(minutes / geometry.snapMinutes) * geometry.snapMinutes;
}

/**
 * Where an event lands for a given pointer delta.
 *
 * Snapping is absolute rather than relative: the result sits on the same lattice
 * the grid draws, so an event that started at an odd minute becomes tidy instead
 * of staying odd forever.
 */
export function nextDragTimes({
  deltaMinutes,
  geometry,
  mode,
  originEndMinutes,
  originStartMinutes,
}: {
  deltaMinutes: number;
  geometry: TimeGeometry;
  mode: DragMode;
  originEndMinutes: number;
  originStartMinutes: number;
}): DragTimes {
  const dayStart = geometry.visibleDayStartMinutes;
  const dayEnd = geometry.visibleDayEndMinutes;
  const minDuration = geometry.snapMinutes;

  if (mode === "move") {
    const duration = originEndMinutes - originStartMinutes;
    // Clamp the start so the whole event stays inside the day, keeping length.
    const startMinutes = Math.max(
      dayStart,
      Math.min(dayEnd - duration, snapTo(originStartMinutes + deltaMinutes, geometry)),
    );
    return { endMinutes: startMinutes + duration, startMinutes };
  }

  if (mode === "resize-start") {
    // The opposite edge is the anchor; never let the event invert or vanish.
    const startMinutes = Math.max(
      dayStart,
      Math.min(
        originEndMinutes - minDuration,
        snapTo(originStartMinutes + deltaMinutes, geometry),
      ),
    );
    return { endMinutes: originEndMinutes, startMinutes };
  }

  const endMinutes = Math.min(
    dayEnd,
    Math.max(
      originStartMinutes + minDuration,
      snapTo(originEndMinutes + deltaMinutes, geometry),
    ),
  );
  return { endMinutes, startMinutes: originStartMinutes };
}

/** Column a pointer is over, clamped to the rendered days. */
export function dayIndexFromX(
  clientX: number,
  gridLeft: number,
  columnWidth: number,
  dayCount: number,
): number {
  if (columnWidth <= 0) return 0;
  const index = Math.floor((clientX - gridLeft) / columnWidth);
  return Math.max(0, Math.min(dayCount - 1, index));
}

/**
 * How far to auto-scroll when the pointer nears an edge of the viewport.
 *
 * Returns px per frame; 0 means the pointer is comfortably inside. Without this
 * a drag cannot reach a time that is off screen.
 */
export function autoScrollStep(
  clientY: number,
  viewport: { bottom: number; top: number },
  { maxStep = 18, zone = 48 }: { maxStep?: number; zone?: number } = {},
): number {
  const fromTop = clientY - viewport.top;
  const fromBottom = viewport.bottom - clientY;

  if (fromTop < zone) {
    // Ramps up as the pointer gets closer to the edge.
    return -maxStep * Math.min(1, (zone - fromTop) / zone);
  }
  if (fromBottom < zone) {
    return maxStep * Math.min(1, (zone - fromBottom) / zone);
  }
  return 0;
}

/** A pointer has to travel before a press becomes a drag, or clicks get eaten. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * The moment a touch stops being a flick and becomes a hold.
 *
 * Both gestures live on the same cells: below this a sideways move pages the
 * calendar, above it the finger is dragging out a range. One constant, so the
 * window where both could fire cannot exist. The native client draws the same
 * line at 280 ms, so the muscle memory carries over.
 */
export const TOUCH_HOLD_MS = 280;

export type MovePreviewRange = {
  /** First day the event would land on. */
  from: string;
  /** The run being left behind, where the ghost stays. Kept apart from the run
      being landed on: a week row between the two holds neither, so testing the
      hull would make half the month step aside for nothing. */
  originFrom: string;
  originTo: string;
  /** Last day the event would land on. */
  to: string;
};

/**
 * Where a dragged event would land, as a day range, alongside the run it comes
 * from. A month cell draws an all-day event as one block per cell, so the
 * preview needs the whole run rather than the day under the pointer.
 */
export function movePreviewRange(
  dayKeys: string[],
  shift: number,
): MovePreviewRange {
  const originFrom = dayKeys[0]!;
  const originTo = dayKeys[dayKeys.length - 1]!;

  return {
    from: shiftDayKey(originFrom, shift),
    originFrom,
    originTo,
    to: shiftDayKey(originTo, shift),
  };
}

export function exceedsDragThreshold(
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  return (
    Math.abs(to.x - from.x) >= DRAG_THRESHOLD_PX ||
    Math.abs(to.y - from.y) >= DRAG_THRESHOLD_PX
  );
}
