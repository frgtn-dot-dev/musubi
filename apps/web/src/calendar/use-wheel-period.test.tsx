import { render, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWheelPeriod } from "./use-wheel-period";

function Surface({ enabled = true, onChange }: { enabled?: boolean; onChange: (offset: number) => void }) {
  const ref = useWheelPeriod(enabled, onChange);
  return <div ref={ref} data-testid="surface"><input aria-label="Title" /></div>;
}
afterEach(() => vi.restoreAllMocks());
it("moves once per burst and allows the next gesture in either direction", () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  const change = vi.fn();
  const { getByTestId } = render(<Surface onChange={change} />);
  const surface = getByTestId("surface");
  fireEvent.wheel(surface, { deltaY: 100 });
  clock.mockReturnValue(1100);
  fireEvent.wheel(surface, { deltaY: 100 });
  expect(change.mock.calls).toEqual([[1]]);
  clock.mockReturnValue(1400);
  fireEvent.wheel(surface, { deltaY: -100 });
  expect(change.mock.calls).toEqual([[1], [-1]]);
});
it("accumulates small trackpad deltas without losing the gesture on rerender", () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const first = vi.fn(), latest = vi.fn();
  const { getByTestId, rerender } = render(<Surface onChange={first} />);
  fireEvent.wheel(getByTestId("surface"), { deltaY: 20 });
  rerender(<Surface onChange={latest} />);
  fireEvent.wheel(getByTestId("surface"), { deltaY: 25 });
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledWith(1);
});
it("preserves zoom, horizontal scroll and form input", () => {
  const change = vi.fn();
  const { getByTestId, getByRole } = render(<Surface onChange={change} />);
  fireEvent.wheel(getByTestId("surface"), { deltaY: 100, ctrlKey: true });
  fireEvent.wheel(getByTestId("surface"), { deltaY: 10, deltaX: 100 });
  fireEvent.wheel(getByRole("textbox"), { deltaY: 100 });
  expect(change).not.toHaveBeenCalled();
});
it("does not intercept the wheel outside the month view", () => {
  const change = vi.fn();
  const { getByTestId, rerender } = render(<Surface onChange={change} />);
  rerender(<Surface enabled={false} onChange={change} />);
  expect(fireEvent.wheel(getByTestId("surface"), { deltaY: 100, cancelable: true })).toBe(true);
  expect(change).not.toHaveBeenCalled();
});
