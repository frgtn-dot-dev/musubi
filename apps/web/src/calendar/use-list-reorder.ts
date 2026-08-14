import { useCallback, useEffect, useRef, useState } from "react";
import { dropIndexAt, type RowBox } from "./list-reorder";
import { DRAG_THRESHOLD_PX, TOUCH_HOLD_MS } from "./time-grid-drag";

export type ReorderDrag = {
  /** Every row's box as measured when the drag started. */
  boxes: RowBox[];
  /** How far the held row has travelled, so it can track the pointer exactly. */
  dy: number;
  from: number;
  to: number;
};

/**
 * Drag a row to a new place in a short vertical list.
 *
 * Same pointer model as the calendar's own gestures: listeners are attached on
 * press, a mouse becomes a drag once it has travelled `DRAG_THRESHOLD_PX`, and a
 * finger has to stay down for `TOUCH_HOLD_MS` first — otherwise scrolling the
 * sidebar would rearrange it. Escape cancels, and the trailing click is swallowed
 * so releasing over another row doesn't also activate it.
 */
export function useListReorder({
  onCommit,
}: {
  onCommit: (move: ReorderDrag) => void;
}) {
  const [drag, setDrag] = useState<ReorderDrag>();
  // True while the saved order swaps in. The held row is already sitting where it
  // lands, so a transition on that change would slide it back out of place and
  // then in again — the blink you get on drop. A cancelled drag still glides home.
  //
  // Cleared after *two* frames on purpose: a single `requestAnimationFrame` runs
  // before the next paint, so re-enabling transitions there lands in the same
  // paint as the reorder and the transition fires anyway.
  const [settling, setSettling] = useState(false);
  const pressRef = useRef<
    | {
        boxes: RowBox[];
        from: number;
        pointerId: number;
        startY: number;
        time: number;
        touch: boolean;
      }
    | undefined
  >(undefined);
  const dragRef = useRef<ReorderDrag | undefined>(undefined);
  const consumedRef = useRef(false);
  const detachRef = useRef<(() => void) | undefined>(undefined);
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  });

  const finish = useCallback(() => {
    pressRef.current = undefined;
    dragRef.current = undefined;
    detachRef.current?.();
    detachRef.current = undefined;
    setDrag(undefined);
  }, []);

  useEffect(() => finish, [finish]);

  const begin = useCallback(
    (input: {
      /** Every row's box, in list order, as it stands right now. */
      boxes: RowBox[];
      index: number;
      pointerId: number;
      pointerType: string;
      time: number;
      y: number;
    }) => {
      pressRef.current = {
        boxes: input.boxes,
        from: input.index,
        pointerId: input.pointerId,
        startY: input.y,
        time: input.time,
        touch: input.pointerType === "touch",
      };

      function handleMove(event: PointerEvent) {
        const press = pressRef.current;
        if (!press || event.pointerId !== press.pointerId) return;

        if (!dragRef.current) {
          const held = event.timeStamp - press.time >= TOUCH_HOLD_MS;
          const moved =
            Math.abs(event.clientY - press.startY) >= DRAG_THRESHOLD_PX;
          if (press.touch ? !held : !moved) return;
        }

        event.preventDefault();
        const next = {
          boxes: press.boxes,
          dy: event.clientY - press.startY,
          from: press.from,
          to: dropIndexAt(event.clientY, press.boxes),
        };
        dragRef.current = next;
        setDrag(next);
      }

      function handleUp(event: PointerEvent) {
        const press = pressRef.current;
        if (!press || event.pointerId !== press.pointerId) return;
        const move = dragRef.current;
        finish();

        if (move && move.to !== move.from) {
          // The row moved, so the release is not a selection.
          consumedRef.current = true;
          setSettling(true);
          onCommitRef.current(move);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => setSettling(false)),
          );
        }
      }

      function handleKeyDown(event: KeyboardEvent) {
        if (event.key !== "Escape" || !pressRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        finish();
      }

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
      window.addEventListener("keydown", handleKeyDown, true);
      detachRef.current = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
        window.removeEventListener("keydown", handleKeyDown, true);
      };
    },
    [finish],
  );

  return {
    begin,
    /** True once for the click that ended a drag, so it is not also a choice. */
    consumeClick: () => {
      const consumed = consumedRef.current;
      consumedRef.current = false;
      return consumed;
    },
    drag,
    settling,
  };
}
