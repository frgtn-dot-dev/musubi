import { useCallback, useEffect, useRef, useState } from "react";
import { clampOffset, type Offset } from "./window-drag";

const NARROW_QUERY = "(max-width: 600px)";

/**
 * Drag a floating layer around by a handle, without letting it leave its bounds.
 *
 * The layer keeps its anchored position and is moved by a transform, so nothing
 * about how it was placed has to be re-derived — and no collision logic can flip
 * it sideways halfway through a drag.
 *
 * Below the narrow breakpoint the layer is a bottom sheet: it has one place to
 * be, so the gesture is not offered at all.
 */
export function useWindowDrag({
  bounds,
  element,
}: {
  /** Where the layer may go. Read at press time, in viewport coordinates. */
  bounds: () => DOMRect | undefined;
  element: () => HTMLElement | null | undefined;
}) {
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const offsetRef = useRef<Offset>({ x: 0, y: 0 });
  const detachRef = useRef<(() => void) | undefined>(undefined);
  const optionsRef = useRef({ bounds, element });
  useEffect(() => {
    optionsRef.current = { bounds, element };
  });

  const finish = useCallback(() => {
    detachRef.current?.();
    detachRef.current = undefined;
  }, []);

  const begin = useCallback(
    (input: { pointerId: number; x: number; y: number }) => {
      if (window.matchMedia(NARROW_QUERY).matches) return;

      const node = optionsRef.current.element();
      const area = optionsRef.current.bounds();
      if (!node || !area) return;

      const rect = node.getBoundingClientRect();
      const start = offsetRef.current;
      // The position the layer would have with no offset — the fixed point every
      // clamp is measured from, so repeated drags cannot drift.
      const base = {
        height: rect.height,
        left: rect.left - start.x,
        top: rect.top - start.y,
        width: rect.width,
      };

      function handleMove(nativeEvent: PointerEvent) {
        if (nativeEvent.pointerId !== input.pointerId) return;
        nativeEvent.preventDefault();
        const next = clampOffset({
          base,
          bounds: area!,
          offset: {
            x: start.x + (nativeEvent.clientX - input.x),
            y: start.y + (nativeEvent.clientY - input.y),
          },
        });
        offsetRef.current = next;
        setOffset(next);
      }

      function handleUp(nativeEvent: PointerEvent) {
        if (nativeEvent.pointerId !== input.pointerId) return;
        finish();
      }

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", finish);
      detachRef.current = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", finish);
      };
    },
    [finish],
  );

  useEffect(() => finish, [finish]);

  return { begin, moved: offset.x !== 0 || offset.y !== 0, offset };
}
