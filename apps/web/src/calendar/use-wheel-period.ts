import { useEffect, useLayoutEffect, useRef } from "react";

/** One month per wheel burst, including the inertial tail of trackpad gestures. */
export function useWheelPeriod(enabled: boolean, onChange: (offset: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const change = useRef(onChange);
  useLayoutEffect(() => { change.current = onChange; }, [onChange]);
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    let last = -Infinity, distance = 0, moved = false;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.buttons || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      if (!(event.target instanceof Element)) return;
      // Embedded fields and independently scrolling event lists keep their wheel.
      if (event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      for (let node = event.target; node && node !== root; node = node.parentElement!) {
        if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) return;
      }
      event.preventDefault();
      const now = Date.now();
      if (now - last > 200) { distance = 0; moved = false; }
      last = now;
      if (moved) return;
      distance += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1);
      if (Math.abs(distance) < 40) return;
      moved = true;
      change.current(distance > 0 ? 1 : -1);
    };
    root.addEventListener("wheel", wheel, { passive: false });
    return () => root.removeEventListener("wheel", wheel);
  }, [enabled]);
  return ref;
}
