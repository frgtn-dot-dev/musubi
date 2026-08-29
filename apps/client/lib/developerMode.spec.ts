import { describe, expect, it } from "vitest";
import { registerTap, TAPS_TO_TOGGLE, TAP_WINDOW_MS } from "./developerMode";

/** Tap `times` in a row, one tick apart, starting from a clean state. */
function tapRun(times: number, enabled = false, gapMs = 100) {
  let state = { count: 0, lastAt: 0 };
  let now = 1_000;
  let toggled: boolean | null = null;
  for (let index = 0; index < times; index += 1) {
    now += gapMs;
    const next = registerTap(state, now, enabled);
    state = { count: next.count, lastAt: next.lastAt };
    toggled = next.toggled;
  }
  return { state, toggled };
}

describe("registerTap", () => {
  it("says nothing until the run is complete", () => {
    for (let times = 1; times < TAPS_TO_TOGGLE; times += 1) {
      expect(tapRun(times).toggled).toBeNull();
    }
  });

  it("turns developer mode on at the tenth tap", () => {
    expect(tapRun(TAPS_TO_TOGGLE).toggled).toBe(true);
  });

  it("turns it back off with another ten", () => {
    expect(tapRun(TAPS_TO_TOGGLE, true).toggled).toBe(false);
  });

  // Without the reset, every tap after the tenth would flip the mode again —
  // one enthusiastic run would land on whichever state it happened to stop on.
  it("starts a fresh tally once a run completes", () => {
    const { state } = tapRun(TAPS_TO_TOGGLE);
    expect(state.count).toBe(0);

    const eleventh = registerTap(state, state.lastAt + 100, true);
    expect(eleventh.toggled).toBeNull();
    expect(eleventh.count).toBe(1);
  });

  // Taps spread across a session are not a gesture. Three today and seven next
  // week must not toggle a mode nobody meant to touch.
  it("forgets a tally that went cold", () => {
    const stale = { count: TAPS_TO_TOGGLE - 1, lastAt: 1_000 };
    const late = registerTap(stale, 1_000 + TAP_WINDOW_MS + 1, false);

    expect(late.toggled).toBeNull();
    expect(late.count).toBe(1);
  });

  it("keeps counting while taps stay inside the window", () => {
    const warm = { count: TAPS_TO_TOGGLE - 1, lastAt: 1_000 };
    expect(registerTap(warm, 1_000 + TAP_WINDOW_MS, false).toggled).toBe(true);
  });

  // A slow but deliberate run: each tap inside the window, none of them fast.
  it("completes a run of unhurried taps", () => {
    expect(tapRun(TAPS_TO_TOGGLE, false, TAP_WINDOW_MS - 1).toggled).toBe(true);
  });
});
