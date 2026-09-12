import { act, renderHook } from "@testing-library/react";
import { createTimeGeometry } from "./time-geometry";
import { useTimeGridDrag } from "./use-time-grid-drag";

function pointer(type: string, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: 100, clientY: y });
  Object.defineProperty(event, "pointerId", { value: 1 });
  window.dispatchEvent(event);
}

it("cancels immediately with Escape and consumes the eventual release click only", () => {
  const onCommit = vi.fn().mockResolvedValue(undefined);
  const { result, unmount } = renderHook(() => useTimeGridDrag<undefined>({
    columns: () => ({ count: 1, left: 0, width: 500 }),
    geometry: createTimeGeometry(),
    onCommit,
    onError: vi.fn(),
    scrollRoot: () => undefined,
  }));
  act(() => result.current.begin({ dayIndex: 0, event: undefined, mode: "move", pointerId: 1, startMinutes: 600, endMinutes: 660, x: 100, y: 100 }));
  act(() => pointer("pointermove", 150));
  expect(result.current.drag).toBeDefined();
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(result.current.drag).toBeUndefined();
  // The pointer may move again before its button is released.
  act(() => pointer("pointermove", 200));
  expect(result.current.drag).toBeUndefined();
  act(() => pointer("pointerup", 200));
  const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: 100, clientY: 200 });
  document.body.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
  expect(onCommit).not.toHaveBeenCalled();
  const nextClick = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: 100, clientY: 200 });
  document.body.dispatchEvent(nextClick);
  expect(nextClick.defaultPrevented).toBe(false);
  unmount();
});
