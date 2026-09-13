import { useLayoutEffect, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import type { Task } from "@musubi/types";

/** Pointer-only visual preview; the same status mutation serves keyboard and touch selects. */
export function useKanbanDrag(onMove: (task: Task, status: Task["status"]) => Promise<boolean>) {
  const [draggingId, setDraggingId] = useState<string>();
  const [targetStatus, setTargetStatus] = useState<string>();
  const latestMove = useRef(onMove);
  useLayoutEffect(() => { latestMove.current = onMove; }, [onMove]);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);

  function begin(task: Task, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || cleanup.current) return;
    const card = event.currentTarget.closest<HTMLElement>("[data-task-id]");
    const scroller = card?.closest<HTMLElement>("[data-kanban-scroll]");
    if (!card || !scroller) return;
    event.preventDefault();
    const start = card.getBoundingClientRect();
    scroller.style.setProperty("--kanban-drag-height", `${start.height}px`);
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("id");
    ghost.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    ghost.dataset.dragPreview = "true";
    Object.assign(ghost.style, { position: "fixed", top: "0", left: "0", width: `${start.width}px`, height: `${start.height}px`, margin: "0", zIndex: "1000", pointerEvents: "none", boxSizing: "border-box", transformOrigin: "center" });
    document.body.append(ghost);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let x = event.clientX, y = event.clientY, frame = 0, active = true, finishing = false;
    let over: string | undefined;
    const dx = x - start.left, dy = y - start.top;
    const paint = () => { ghost.style.transform = `translate3d(${x - dx}px, ${y - dy}px, 0)${reduced ? "" : " rotate(1.5deg) scale(1.025)"}`; };
    const hit = () => {
      const column = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-kanban-status]");
      const next = column && scroller.contains(column) ? column.dataset.kanbanStatus : undefined;
      if (next !== over) { over = next; setTargetStatus(next); }
    };
    const tick = () => {
      const bounds = scroller.getBoundingClientRect();
      if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
        scroller.scrollLeft += x > bounds.right - 40 ? 10 : x < bounds.left + 40 ? -10 : 0;
        scroller.scrollTop += y > bounds.bottom - 40 ? 10 : y < bounds.top + 40 ? -10 : 0;
      }
      paint(); hit(); frame = requestAnimationFrame(tick);
    };
    const move = (next: PointerEvent) => { if (next.pointerId === event.pointerId) { x = next.clientX; y = next.clientY; } };
    const detach = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
    };
    const dispose = () => { active = false; detach(); ghost.getAnimations?.().forEach(animation => animation.cancel()); ghost.remove(); scroller.style.removeProperty("--kanban-drag-height"); cleanup.current = undefined; };
    const travel = async (rect: DOMRect) => {
      const transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
      if (!reduced && ghost.animate) {
        await ghost.animate([{ transform: ghost.style.transform }, { transform }], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" }).finished.catch(() => {});
      }
      ghost.style.transform = transform;
      ghost.getAnimations?.().forEach(animation => animation.cancel());
    };
    const finish = async (cancelled: boolean) => {
      if (finishing) return;
      finishing = true;
      detach();
      const target = !cancelled && over && over !== task.status ? over as Task["status"] : undefined;
      const placeholder = target ? scroller.querySelector<HTMLElement>(`[data-kanban-status="${target}"] [data-drop-placeholder]`) : undefined;
      const destination = placeholder?.getBoundingClientRect() ?? card.getBoundingClientRect();
      // Start the optimistic move immediately; the preview only lives for the
      // landing animation, never for the duration of the network request.
      let failed = false;
      const saving = target ? latestMove.current(task, target).catch(() => false).then(saved => { failed = !saved; }) : undefined;
      await travel(destination);
      if (!active) return;
      if (failed) {
        const restored = Array.from(scroller.querySelectorAll<HTMLElement>("[data-task-id]")).find(node => node.dataset.taskId === task.id);
        await travel(restored?.getBoundingClientRect() ?? start);
        if (!active) return;
      }
      // Reveal the committed card before removing its preview, in the same
      // paint. Otherwise React batching leaves a dim card for one frame.
      flushSync(() => { setDraggingId(undefined); setTargetStatus(undefined); });
      dispose();
      // The task list owns rollback and animates the card back if saving fails.
      await saving;
    }
    const up = (next: PointerEvent) => { if (next.pointerId !== event.pointerId) return; x = next.clientX; y = next.clientY; hit(); void finish(false); };
    const cancel = (next?: PointerEvent) => { if (!next || next.pointerId === event.pointerId) void finish(true); };
    const key = (next: KeyboardEvent) => { if (next.key === "Escape") { next.preventDefault(); next.stopPropagation(); cancel(); } };
    cleanup.current = dispose;
    paint(); setDraggingId(task.id);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    frame = requestAnimationFrame(tick);
  }
  return { begin, draggingId, targetStatus };
}
