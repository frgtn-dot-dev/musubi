import { useCallback, useEffect, useRef } from "react";
import { TOUCH_HOLD_MS } from "./time-grid-drag";

// ── Flick tuning ────────────────────────────────────────────────────────────
/** Shorter than this is a tap, a wobble, or the start of a scroll. */
const MIN_DISTANCE_PX = 56;
/** Vertical travel allowed as a fraction of horizontal: scrolling must win. */
const MAX_OFF_AXIS_RATIO = 0.6;
/**
 * A flick is fast. Past `TOUCH_HOLD_MS` the same finger is dragging out a range
 * instead (see `time-grid-drag.ts`) — sharing that one constant is what keeps a
 * window where both gestures fire from existing.
 */
const MAX_DURATION_MS = TOUCH_HOLD_MS;

/**
 * Flick left or right across the calendar to move a period, the way the native
 * client's pager does.
 *
 * Touch only. A mouse has the toolbar arrows, and a trackpad's two-finger
 * horizontal scroll is not a gesture we should read as intent.
 */
export function useSwipePeriod(onChange: (offset: number) => void) {
  const pressRef = useRef<
    { pointerId: number; time: number; x: number; y: number } | undefined
  >(undefined);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const finish = useCallback((event: PointerEvent) => {
    const press = pressRef.current;
    if (!press || event.pointerId !== press.pointerId) return;
    pressRef.current = undefined;

    if (event.type !== "pointerup") return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (
      Math.abs(dx) < MIN_DISTANCE_PX ||
      Math.abs(dy) > Math.abs(dx) * MAX_OFF_AXIS_RATIO ||
      event.timeStamp - press.time > MAX_DURATION_MS
    ) {
      return;
    }

    // Flick left to go forward, the direction the content moves under a finger.
    onChangeRef.current(dx < 0 ? 1 : -1);
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [finish]);

  return {
    onPointerDown: (event: {
      clientX: number;
      clientY: number;
      pointerId: number;
      pointerType: string;
      timeStamp: number;
    }) => {
      if (event.pointerType !== "touch") return;
      pressRef.current = {
        pointerId: event.pointerId,
        time: event.timeStamp,
        x: event.clientX,
        y: event.clientY,
      };
    },
  };
}
