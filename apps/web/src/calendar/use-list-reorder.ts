import { useCallback, useEffect, useRef, useState } from "react";
import { dropIndexAt, type RowBox } from "./list-reorder";
import { DRAG_THRESHOLD_PX, TOUCH_HOLD_MS } from "./time-grid-drag";

export type ReorderDrag = { from: number; to: number };

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
        const to = dropIndexAt(event.clientY, press.boxes);
        const next = { from: press.from, to };
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
          onCommitRef.current(move);
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
  };
}
