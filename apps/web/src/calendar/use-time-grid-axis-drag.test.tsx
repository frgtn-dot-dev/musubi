import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildDayAxis, sharedWeekAxis } from "./day-axis";
import { createTimeGeometry } from "./time-geometry";
import { useDragToCreate, useTimeGridDrag } from "./use-time-grid-drag";

const axis = sharedWeekAxis([buildDayAxis("2026-03-28", "Europe/Prague"), buildDayAxis("2026-03-29", "Europe/Prague")]);
const geometry = { ...createTimeGeometry(), pxPerMinute: 1 };
function pointer(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, "pointerId", { value: 1 });
  act(() => window.dispatchEvent(event));
}
describe("DST pointer state machine", () => {
  it("does not commit the last valid preview when released inside a hole", () => {
    const onCommit = vi.fn(async () => {}), onError = vi.fn();
    const hook = renderHook(() => useTimeGridDrag({ axis, geometry, columns: () => ({ count: 2, left: 0, width: 100 }), onCommit, onError, scrollRoot: () => null }));
    act(() => hook.result.current.begin({ dayIndex: 0, event: {} as never, startMinutes: 150, endMinutes: 180, mode: "move", pointerId: 1, x: 10, y: 150 }));
    pointer("pointermove", 10, 165);
    expect(hook.result.current.drag?.times.startMinutes).toBe(165);
    pointer("pointermove", 150, 150);
    expect(hook.result.current.drag?.dayIndex).toBe(0);
    pointer("pointerup", 150, 150);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("no local time"));
    const saveClick = new MouseEvent("click", { clientX: 400, clientY: 300, detail: 1, bubbles: true, cancelable: true });
    document.dispatchEvent(saveClick);
    expect(saveClick.defaultPrevented).toBe(false);
    hook.unmount();
  });
  it("does not create the earlier valid selection after moving into a missing endpoint", () => {
    const onSelected = vi.fn();
    const column = document.createElement("div");
    column.getBoundingClientRect = () => ({ top: 0 } as DOMRect);
    const hook = renderHook(() => useDragToCreate({ axis, geometry, onSelected }));
    act(() => hook.result.current.begin({ column, dayIndex: 1, pointerId: 1, clientY: 60 }));
    pointer("pointermove", 0, 90);
    expect(hook.result.current.selection?.exactRange?.end.toISOString()).toBe("2026-03-29T00:30:00.000Z");
    pointer("pointermove", 0, 150);
    pointer("pointerup", 0, 150);
    expect(onSelected).not.toHaveBeenCalled();
    expect(hook.result.current.consumeClick()).toBe(true);
    hook.unmount();
  });
});
