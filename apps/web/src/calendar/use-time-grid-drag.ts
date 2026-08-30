import type { Event } from "@musubi/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { yToMinutes, type TimeGeometry } from "./time-geometry";
import {
  autoScrollStep,
  exceedsDragThreshold,
  TOUCH_HOLD_MS,
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

/**
 * What is being dragged is generic: a real event on the grid, or the draft a
 * drag-to-create just laid down, which has no event yet. Everything else about
 * the gesture — threshold, snapping, auto-scroll, Escape — is the same.
 */
export type DragState<T = Event> = {
  /** Column the pointer is over — the drop target in week view. */
  dayIndex: number;
  event: T;
  mode: DragMode;
  times: DragTimes;
};

type Press<T> = {
  dayIndex: number;
  event: T;
  mode: DragMode;
  originEndMinutes: number;
  originStartMinutes: number;
  pointerId: number;
  startScrollTop: number;
  startX: number;
  startY: number;
};

export type BeginDragInput<T = Event> = {
  dayIndex: number;
  endMinutes: number;
  event: T;
  mode: DragMode;
  pointerId: number;
  startMinutes: number;
  x: number;
  y: number;
};

export type TimeGridDragOptions<T = Event> = {
  /** Column geometry, so a move can change day. */
  columns: () => { count: number; left: number; width: number };
  geometry: TimeGeometry;
  /** Commit the drop. A rejection means the event snaps back. */
  onCommit: (input: {
    dayOffset: number;
    event: T;
    mode: DragMode;
    times: DragTimes;
  }) => Promise<unknown>;
  onError: (message: string) => void;
  scrollRoot: () => HTMLElement | null | undefined;
};

const AUTO_SCROLL_MS = 16;

/**
 * The day cell under the pointer, looking through anything floating above it.
 *
 * `elementFromPoint` returns only the topmost element, which during a drag is
 * often the popover describing what is being dragged — so the cell right under
 * the cursor would read as "no target at all". The whole stack is searched
 * instead, and the first cell in it wins.
 */
/* Anything portalled over the calendar. A dialog's own content, a popover or a
   menu, and the backdrop that dims the grid behind them. */
const LAYER_ABOVE_GRID =
  "[role='dialog'], [data-dialog-overlay], [data-radix-popper-content-wrapper]";

/**
 * The day under the pointer, or nothing when a layer is covering the grid.
 *
 * `elementsFromPoint` walks the whole stack rather than stopping at the top, so
 * a cell stays "under the pointer" through an open dialog. The walk is wanted —
 * the draft block sits over the cells and would otherwise be the only answer —
 * but it has to stop at the first surface that belongs to a layer above the
 * calendar, or a gesture keeps tracking a grid the person can no longer see.
 */
function dayKeyAtPoint(x: number, y: number): string | undefined {
  for (const element of document.elementsFromPoint(x, y)) {
    const cell = element.closest<HTMLElement>("[data-day-key]");
    if (cell) return cell.dataset.dayKey;
    if (element.closest(LAYER_ABOVE_GRID)) return undefined;
  }
  return undefined;
}

/** Whether a point is buried under a dialog, popover or menu. */
export function coveredByLayer(x: number, y: number) {
  for (const element of document.elementsFromPoint(x, y)) {
    if (element.closest("[data-day-key]")) return false;
    if (element.closest(LAYER_ABOVE_GRID)) return true;
  }
  return false;
}

/**
 * Swallow the click the browser fires after a drag.
 *
 * A pointer gesture ends in a click on whatever is under the cursor, and that
 * click is not a click the user made: it opens the details popover of the block
 * that was just dropped, or dismisses the one describing the draft that was just
 * dragged. Captured once, at the document, so no layer below ever sees it.
 */
function swallowNextClick() {
  function handleClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    document.removeEventListener("click", handleClick, true);
  }

  document.addEventListener("click", handleClick, true);
  // If no click follows (a cancelled or touch gesture), drop the listener.
  window.setTimeout(
    () => document.removeEventListener("click", handleClick, true),
    350,
  );
}

export function useTimeGridDrag<T = Event>({
  columns,
  geometry,
  onCommit,
  onError,
  scrollRoot,
}: TimeGridDragOptions<T>) {
  const [drag, setDrag] = useState<DragState<T>>();

  const pressRef = useRef<Press<T> | undefined>(undefined);
  const dragRef = useRef<DragState<T> | undefined>(undefined);
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

  /**
   * Stop following the pointer but leave the block where it was dropped.
   *
   * Clearing the whole drag on release would put the event back at its old time
   * until the write lands — and the cache notifies in a later tick, so that gap
   * is visible: the block bounces home and then jumps to where it was dropped.
   */
  const release = useCallback(() => {
    pressRef.current = undefined;
    stopAutoScroll();
    detachRef.current?.();
    detachRef.current = undefined;
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
    (input: BeginDragInput<T>) => {
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

        swallowNextClick();
        if (unchanged) {
          finish();
          return;
        }

        release();
        void commit({
          dayOffset,
          event: active.event,
          mode: active.mode,
          times: active.times,
        })
          .catch((error: unknown) => {
            reportError(
              error instanceof Error
                ? error.message
                : "That change could not be saved. The original time was restored.",
            );
          })
          // Only now does the block stop being drawn where it was dropped: by
          // this point the event itself is there, or the error put it back.
          .finally(finish);
      }

      function handleKey(nativeEvent: KeyboardEvent) {
        if (nativeEvent.key !== "Escape") return;
        // Escape cancels the drag, not the whole screen.
        nativeEvent.stopPropagation();
        finish();
      }

      // Retire any set still attached: a press that never saw its release
      // would otherwise leave a handler on the window for the rest of the
      // session, driven by the next gesture's pointer.
      detachRef.current?.();
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
    [finish, recompute, release, stopAutoScroll],
  );

  // Unmounting mid-gesture must not leave listeners or a timer behind.
  useEffect(() => finish, [finish]);

  return { begin, drag };
}

/**
 * Dragging an event between days in the month grid.
 *
 * Simpler than the time grid: only the date changes, the time of day is kept, so
 * there is no snapping or resizing — the drop target is whichever day cell the
 * pointer is over. The same movement threshold applies, so clicking a chip still
 * opens its preview.
 */
export function useMonthDrag<T = Event>({
  onCommit,
  onError,
}: {
  onCommit: (input: {
    dayKey: string;
    /** Where the drag started, so a caller can work out the day delta. */
    originDayKey: string;
    event: T;
  }) => Promise<unknown>;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<{
    dayKey: string;
    event: T;
    originDayKey: string;
  }>();
  const pressRef = useRef<
    | {
        event: T;
        originDayKey: string;
        pointerId: number;
        startX: number;
        startY: number;
      }
    | undefined
  >(undefined);
  const stateRef = useRef<
    { dayKey: string; event: T; originDayKey: string } | undefined
  >(undefined);
  const detachRef = useRef<(() => void) | undefined>(undefined);
  const optionsRef = useRef({ onCommit, onError });
  useEffect(() => {
    optionsRef.current = { onCommit, onError };
  });

  const finish = useCallback(() => {
    pressRef.current = undefined;
    stateRef.current = undefined;
    detachRef.current?.();
    detachRef.current = undefined;
    setState(undefined);
  }, []);

  /** Stop tracking the pointer, but keep drawing the chip where it was dropped. */
  const release = useCallback(() => {
    pressRef.current = undefined;
    detachRef.current?.();
    detachRef.current = undefined;
  }, []);

  const begin = useCallback(
    (input: {
      event: T;
      originDayKey: string;
      pointerId: number;
      x: number;
      y: number;
    }) => {
      pressRef.current = {
        event: input.event,
        originDayKey: input.originDayKey,
        pointerId: input.pointerId,
        startX: input.x,
        startY: input.y,
      };

      function handleMove(nativeEvent: PointerEvent) {
        const press = pressRef.current;
        if (!press || nativeEvent.pointerId !== press.pointerId) return;
        if (
          !stateRef.current &&
          !exceedsDragThreshold(
            { x: press.startX, y: press.startY },
            { x: nativeEvent.clientX, y: nativeEvent.clientY },
          )
        ) {
          return;
        }

        nativeEvent.preventDefault();
        // The cell under the pointer is the drop target.
        const dayKey =
          dayKeyAtPoint(nativeEvent.clientX, nativeEvent.clientY) ??
          stateRef.current?.dayKey;
        if (!dayKey) return;

        const next = {
          dayKey,
          event: press.event,
          originDayKey: press.originDayKey,
        };
        stateRef.current = next;
        setState(next);
      }

      function handleUp(nativeEvent: PointerEvent) {
        const press = pressRef.current;
        const active = stateRef.current;
        if (!press || nativeEvent.pointerId !== press.pointerId) return;

        const commit = optionsRef.current.onCommit;
        const reportError = optionsRef.current.onError;
        const unchanged = !active || active.dayKey === press.originDayKey;
        // Only after a real drag: a plain click has to reach the chip, which is
        // what opens its details.
        if (active) swallowNextClick();
        if (unchanged || !active) {
          finish();
          return;
        }

        release();
        void commit(active)
          .catch((error: unknown) => {
            reportError(
              error instanceof Error
                ? error.message
                : "That change could not be saved. The original date was restored.",
            );
          })
          // Held until the write lands, so the chip does not flick back to its
          // old day while the cache catches up.
          .finally(finish);
      }

      function handleKey(nativeEvent: KeyboardEvent) {
        if (nativeEvent.key !== "Escape") return;
        nativeEvent.stopPropagation();
        finish();
      }

      // Retire any set still attached: a press that never saw its release
      // would otherwise leave a handler on the window for the rest of the
      // session, driven by the next gesture's pointer.
      detachRef.current?.();
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
    [finish, release],
  );

  useEffect(() => finish, [finish]);

  return { begin, drag: state };
}

export type DayRangeSelection = { fromKey: string; toKey: string };

/**
 * Dragging across empty day cells in the month grid to create a multi-day event.
 *
 * A month cell has no time axis, so the result is an all-day range rather than an
 * interval — the same thing dragging across days gives you in other calendars. A
 * plain click still falls through to the cell's own click handler, and the
 * trailing click after a drag is swallowed via `consumeClick`.
 */
export function useDayRangeCreate({
  onSelected,
}: {
  onSelected: (range: DayRangeSelection, origin: HTMLElement) => void;
}) {
  const [range, setRange] = useState<DayRangeSelection>();
  const pressRef = useRef<
    | {
        cell: HTMLElement;
        fromKey: string;
        pointerId: number;
        startX: number;
        startY: number;
        time: number;
        touch: boolean;
      }
    | undefined
  >(undefined);
  const rangeRef = useRef<DayRangeSelection | undefined>(undefined);
  const consumedRef = useRef(false);
  const detachRef = useRef<(() => void) | undefined>(undefined);
  const onSelectedRef = useRef(onSelected);
  useEffect(() => {
    onSelectedRef.current = onSelected;
  });

  const finish = useCallback(() => {
    pressRef.current = undefined;
    rangeRef.current = undefined;
    detachRef.current?.();
    detachRef.current = undefined;
    setRange(undefined);
  }, []);

  const begin = useCallback(
    (input: {
      cell: HTMLElement;
      dayKey: string;
      pointerId: number;
      pointerType?: string;
      time?: number;
      x: number;
      y: number;
    }) => {
      pressRef.current = {
        cell: input.cell,
        fromKey: input.dayKey,
        pointerId: input.pointerId,
        startX: input.x,
        startY: input.y,
        time: input.time ?? 0,
        touch: input.pointerType === "touch",
      };

      function handleMove(nativeEvent: PointerEvent) {
        const press = pressRef.current;
        if (!press || nativeEvent.pointerId !== press.pointerId) return;
        if (
          press.touch &&
          !rangeRef.current &&
          nativeEvent.timeStamp - press.time < TOUCH_HOLD_MS
        ) {
          return;
        }
        if (
          !rangeRef.current &&
          !exceedsDragThreshold(
            { x: press.startX, y: press.startY },
            { x: nativeEvent.clientX, y: nativeEvent.clientY },
          )
        ) {
          return;
        }

        // A layer opened over the grid ends the gesture rather than freezing it
        // at the anchor: the range would keep re-rendering the month under a
        // surface the person is actually working in, shoving events aside on
        // every move.
        if (coveredByLayer(nativeEvent.clientX, nativeEvent.clientY)) {
          finish();
          return;
        }

        nativeEvent.preventDefault();
        const hovered = dayKeyAtPoint(nativeEvent.clientX, nativeEvent.clientY);
        const toKey = hovered ?? rangeRef.current?.toKey ?? press.fromKey;
        if (rangeRef.current?.toKey === toKey) return;
        const next = { fromKey: press.fromKey, toKey };
        rangeRef.current = next;
        setRange(next);
      }

      function handleUp(nativeEvent: PointerEvent) {
        const press = pressRef.current;
        const active = rangeRef.current;
        if (!press || nativeEvent.pointerId !== press.pointerId) return;

        const cell = press.cell;
        const report = onSelectedRef.current;
        // Only a real multi-day drag counts; a click keeps its own path.
        const dragged = Boolean(active && active.toKey !== active.fromKey);
        consumedRef.current = dragged;
        finish();
        if (dragged && active) report(active, cell);
      }

      function handleKey(nativeEvent: KeyboardEvent) {
        if (nativeEvent.key !== "Escape") return;
        nativeEvent.stopPropagation();
        consumedRef.current = true;
        finish();
      }

      // Retire any set still attached: a press that never saw its release
      // would otherwise leave a handler on the window for the rest of the
      // session, driven by the next gesture's pointer.
      detachRef.current?.();
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
    [finish],
  );

  const consumeClick = useCallback(() => {
    const consumed = consumedRef.current;
    consumedRef.current = false;
    return consumed;
  }, []);

  useEffect(() => finish, [finish]);

  return { begin, consumeClick, range };
}

export type CreateSelection = {
  dayIndex: number;
  endMinutes: number;
  startMinutes: number;
};

/**
 * Dragging across empty grid to choose an interval.
 *
 * A plain click stays a click — the column's own handler deals with that — so
 * this only reports once the pointer has actually travelled. `consumedRef` lets
 * the caller suppress the click that follows a drag, otherwise releasing would
 * both finish the selection and create a second event.
 */
export function useDragToCreate({
  geometry,
  onSelected,
}: {
  geometry: TimeGeometry;
  onSelected: (selection: CreateSelection, origin: HTMLElement) => void;
}) {
  const [selection, setSelection] = useState<CreateSelection>();
  const pressRef = useRef<
    | {
        anchorMinutes: number;
        column: HTMLElement;
        dayIndex: number;
        gridTop: number;
        pointerId: number;
        startY: number;
      }
    | undefined
  >(undefined);
  const selectionRef = useRef<CreateSelection | undefined>(undefined);
  const consumedRef = useRef(false);
  const detachRef = useRef<(() => void) | undefined>(undefined);
  const optionsRef = useRef({ geometry, onSelected });
  useEffect(() => {
    optionsRef.current = { geometry, onSelected };
  });

  const finish = useCallback(() => {
    pressRef.current = undefined;
    selectionRef.current = undefined;
    detachRef.current?.();
    detachRef.current = undefined;
    setSelection(undefined);
  }, []);

  const begin = useCallback(
    (pointerEvent: {
      clientY: number;
      column: HTMLElement;
      dayIndex: number;
      pointerId: number;
    }) => {
      const bounds = pointerEvent.column.getBoundingClientRect();
      const anchorMinutes = yToMinutes(
        pointerEvent.clientY - bounds.top,
        optionsRef.current.geometry,
      );
      pressRef.current = {
        anchorMinutes,
        column: pointerEvent.column,
        dayIndex: pointerEvent.dayIndex,
        gridTop: bounds.top,
        pointerId: pointerEvent.pointerId,
        startY: pointerEvent.clientY,
      };

      function handleMove(nativeEvent: PointerEvent) {
        const press = pressRef.current;
        if (!press || nativeEvent.pointerId !== press.pointerId) return;
        if (
          !selectionRef.current &&
          !exceedsDragThreshold(
            { x: 0, y: press.startY },
            { x: 0, y: nativeEvent.clientY },
          )
        ) {
          return;
        }

        nativeEvent.preventDefault();
        const current = yToMinutes(
          nativeEvent.clientY - press.gridTop,
          optionsRef.current.geometry,
        );
        // Dragging upwards is as valid as downwards.
        const startMinutes = Math.min(press.anchorMinutes, current);
        const endMinutes = Math.max(
          startMinutes + optionsRef.current.geometry.snapMinutes,
          Math.max(press.anchorMinutes, current),
        );
        const next = { dayIndex: press.dayIndex, endMinutes, startMinutes };
        selectionRef.current = next;
        setSelection(next);
      }

      function handleUp(nativeEvent: PointerEvent) {
        const press = pressRef.current;
        const active = selectionRef.current;
        if (!press || nativeEvent.pointerId !== press.pointerId) return;

        const column = press.column;
        const report = optionsRef.current.onSelected;
        // Tell the click handler to stand down — a drag already answered "when".
        consumedRef.current = Boolean(active);
        finish();
        if (active) report(active, column);
      }

      function handleKey(nativeEvent: KeyboardEvent) {
        if (nativeEvent.key !== "Escape") return;
        nativeEvent.stopPropagation();
        consumedRef.current = true;
        finish();
      }

      // Retire any set still attached: a press that never saw its release
      // would otherwise leave a handler on the window for the rest of the
      // session, driven by the next gesture's pointer.
      detachRef.current?.();
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
    [finish],
  );

  /** True once per drag, so the caller can skip the trailing click. */
  const consumeClick = useCallback(() => {
    const consumed = consumedRef.current;
    consumedRef.current = false;
    return consumed;
  }, []);

  useEffect(() => finish, [finish]);

  return { begin, consumeClick, selection };
}
