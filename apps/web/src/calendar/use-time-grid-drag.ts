import type { Event } from "@musubi/types";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TimeGeometry } from "./time-geometry";
import {
  autoScrollStep,
  exceedsDragThreshold,
  nextDragTimes,
  type DragMode,
  type DragTimes,
} from "./time-grid-drag";

// The pointer state machine for the time grid (docs/ui/calendar-ui.md §4):
//
//   idle -> pressCandidate -> dragging|resizing -> commit|rollback -> idle
//
// A press only becomes a drag past a movement threshold, so clicking an event
// still opens its preview. Nothing touches the network while the pointer moves;
// the commit happens once, on release.
//
// Listeners are attached on press and torn down on release rather than from an
// effect keyed on the ghost — re-registering them on every pointermove would
// churn and can drop events mid-gesture.

export type DragState = {
  /** Column the pointer is over — the drop target in week view. */
  dayIndex: number;
  event: Event;
  mode: DragMode;
  times: DragTimes;
};

type Press = {
  dayIndex: number;
  event: Event;
  mode: DragMode;
  originEndMinutes: number;
  originStartMinutes: number;
  pointerId: number;
  startScrollTop: number;
  startX: number;
  startY: number;
};

export type BeginDragInput = {
  dayIndex: number;
  endMinutes: number;
  event: Event;
  mode: DragMode;
  pointerId: number;
  startMinutes: number;
  x: number;
  y: number;
};

export type TimeGridDragOptions = {
  /** Column geometry, so a move can change day. */
  columns: () => { count: number; left: number; width: number };
  geometry: TimeGeometry;
  /** Commit the drop. A rejection means the event snaps back. */
  onCommit: (input: {
    dayOffset: number;
    event: Event;
    mode: DragMode;
    times: DragTimes;
  }) => Promise<unknown>;
  onError: (message: string) => void;
  scrollRoot: () => HTMLElement | null | undefined;
};

const AUTO_SCROLL_MS = 16;

export function useTimeGridDrag({
  columns,
  geometry,
  onCommit,
  onError,
  scrollRoot,
}: TimeGridDragOptions) {
  const [drag, setDrag] = useState<DragState>();

  const pressRef = useRef<Press | undefined>(undefined);
  const dragRef = useRef<DragState | undefined>(undefined);
  const pointerRef = useRef({ x: 0, y: 0 });
  const autoScrollRef = useRef<number | undefined>(undefined);
  const detachRef = useRef<(() => void) | undefined>(undefined);
  // Read through refs inside listeners so the gesture always sees current values
  // without needing to re-attach.
  const optionsRef = useRef({ columns, geometry, onCommit, onError, scrollRoot });
  useEffect(() => {
    optionsRef.current = { columns, geometry, onCommit, onError, scrollRoot };
  });

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current !== undefined) {
      window.clearInterval(autoScrollRef.current);
      autoScrollRef.current = undefined;
    }
  }, []);

  const finish = useCallback(() => {
    pressRef.current = undefined;
    dragRef.current = undefined;
    stopAutoScroll();
    detachRef.current?.();
    detachRef.current = undefined;
    setDrag(undefined);
  }, [stopAutoScroll]);

  /** Recompute the ghost from the latest pointer position and scroll offset. */
  const recompute = useCallback(() => {
    const press = pressRef.current;
    if (!press) return;

    const { columns: readColumns, geometry: currentGeometry, scrollRoot: readRoot } =
      optionsRef.current;
    const root = readRoot();
    const grid = readColumns();

    // Travel in px, including anything auto-scroll moved under the pointer.
    const deltaPx =
      pointerRef.current.y -
      press.startY +
      ((root?.scrollTop ?? 0) - press.startScrollTop);

    const times = nextDragTimes({
      deltaMinutes: deltaPx / currentGeometry.pxPerMinute,
      geometry: currentGeometry,
      mode: press.mode,
      originEndMinutes: press.originEndMinutes,
      originStartMinutes: press.originStartMinutes,
    });

    // Only a move changes day; a resize stays in its column.
    const dayIndex =
      press.mode === "move" && grid.width > 0
        ? Math.max(
            0,
            Math.min(
              grid.count - 1,
              Math.floor((pointerRef.current.x - grid.left) / grid.width),
            ),
          )
        : press.dayIndex;

    const next = {
      dayIndex,
      event: press.event,
      mode: press.mode,
      times,
    };
    dragRef.current = next;
    setDrag(next);
  }, []);

  const begin = useCallback(
    (input: BeginDragInput) => {
      const root = optionsRef.current.scrollRoot();
      pressRef.current = {
        dayIndex: input.dayIndex,
        event: input.event,
        mode: input.mode,
        originEndMinutes: input.endMinutes,
        originStartMinutes: input.startMinutes,
        pointerId: input.pointerId,
        startScrollTop: root?.scrollTop ?? 0,
        startX: input.x,
        startY: input.y,
      };
      pointerRef.current = { x: input.x, y: input.y };

      function handleMove(nativeEvent: PointerEvent) {
        const press = pressRef.current;
        if (!press || nativeEvent.pointerId !== press.pointerId) return;

        pointerRef.current = { x: nativeEvent.clientX, y: nativeEvent.clientY };

        // Below the threshold this is still a click in progress.
        if (
          !dragRef.current &&
          !exceedsDragThreshold(
            { x: press.startX, y: press.startY },
            { x: nativeEvent.clientX, y: nativeEvent.clientY },
          )
        ) {
          return;
        }

        nativeEvent.preventDefault();
        recompute();

        const scroller = optionsRef.current.scrollRoot();
        if (!scroller) return;
        const bounds = scroller.getBoundingClientRect();
        const step = autoScrollStep(nativeEvent.clientY, {
          bottom: bounds.bottom,
          top: bounds.top,
        });

        if (step === 0) {
          stopAutoScroll();
          return;
        }
        if (autoScrollRef.current !== undefined) return;

        // A drag must be able to reach a time that is off screen.
        autoScrollRef.current = window.setInterval(() => {
          const element = optionsRef.current.scrollRoot();
          if (!element) return;
          const rect = element.getBoundingClientRect();
          const current = autoScrollStep(pointerRef.current.y, {
            bottom: rect.bottom,
            top: rect.top,
          });
          if (current === 0) {
            stopAutoScroll();
            return;
          }
          element.scrollTop = element.scrollTop + current;
          recompute();
        }, AUTO_SCROLL_MS);
      }

      function handleUp(nativeEvent: PointerEvent) {
        const press = pressRef.current;
        const active = dragRef.current;
        if (!press || nativeEvent.pointerId !== press.pointerId) return;

        // Released without travelling: let the click handler open the preview.
        if (!active) {
          finish();
          return;
        }

        const dayOffset = active.dayIndex - press.dayIndex;
        const unchanged =
          dayOffset === 0 &&
          active.times.startMinutes === press.originStartMinutes &&
          active.times.endMinutes === press.originEndMinutes;
        const commit = optionsRef.current.onCommit;
        const reportError = optionsRef.current.onError;

        finish();
        if (unchanged) return;

        void commit({
          dayOffset,
          event: active.event,
          mode: active.mode,
          times: active.times,
        }).catch((error: unknown) => {
          // The ghost is gone, so the event is already back at its old time.
          reportError(
            error instanceof Error
              ? error.message
              : "That change could not be saved. The original time was restored.",
          );
        });
      }

      function handleKey(nativeEvent: KeyboardEvent) {
        if (nativeEvent.key !== "Escape") return;
        // Escape cancels the drag, not the whole screen.
        nativeEvent.stopPropagation();
        finish();
      }

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", finish);
      window.addEventListener("keydown", handleKey, true);

      detachRef.current = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", finish);
        window.removeEventListener("keydown", handleKey, true);
      };
    },
    [finish, recompute, stopAutoScroll],
  );

  // Unmounting mid-gesture must not leave listeners or a timer behind.
  useEffect(() => finish, [finish]);

  return { begin, drag };
}
