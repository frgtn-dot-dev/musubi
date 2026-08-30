import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PollLegend } from "./PollGrid";

/** jsdom lays nothing out, so the overflow the legend reacts to is stated. */
function stubOverflow(scrollWidth: number, clientWidth: number) {
  for (const [name, value] of [
    ["scrollWidth", scrollWidth],
    ["clientWidth", clientWidth],
  ] as const) {
    Object.defineProperty(HTMLDivElement.prototype, name, {
      configurable: true,
      get: () => value,
    });
  }
}

afterEach(() => {
  for (const name of ["scrollWidth", "clientWidth"] as const) {
    Reflect.deleteProperty(HTMLDivElement.prototype, name);
  }
});

/**
 * Mirrors the real call site: the legend renders beside a grid that only exists
 * once the answers have arrived, so on a cold open its ref is still empty.
 */
function Harness({ gridReady }: { gridReady: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <>
      {gridReady ? <div ref={scroller} /> : null}
      <PollLegend scrollerRef={scroller} />
    </>
  );
}

describe("PollLegend", () => {
  it("says nothing about paging when the days already fit", () => {
    stubOverflow(300, 300);
    render(<Harness gridReady />);

    expect(screen.queryByRole("button", { name: "Later days" })).toBeNull();
  });

  it("offers the arrows once the grid is wider than its box", () => {
    stubOverflow(900, 300);
    render(<Harness gridReady />);

    expect(screen.getByRole("button", { name: "Later days" })).toBeTruthy();
  });

  /**
   * The bug this exists for: keyed on the ref object — which never changes —
   * the measurement ran once against an empty ref and gave up, so the arrows
   * only appeared the second time the poll was opened.
   */
  it("finds the grid that arrives after it does", () => {
    stubOverflow(900, 300);
    const view = render(<Harness gridReady={false} />);
    expect(screen.queryByRole("button", { name: "Later days" })).toBeNull();

    view.rerender(<Harness gridReady />);
    expect(screen.getByRole("button", { name: "Later days" })).toBeTruthy();
  });
});
