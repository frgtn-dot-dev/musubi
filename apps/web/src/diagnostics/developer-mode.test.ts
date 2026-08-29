import { beforeEach, describe, expect, it } from "vitest";
import {
  CLICK_WINDOW_MS,
  CLICKS_TO_TOGGLE,
  developerModeEnabled,
  registerClick,
  setDeveloperMode,
} from "./developer-mode";

/** Click `times` in a row, one tick apart, from a clean tally. */
function clickRun(times: number, enabled = false, gapMs = 100) {
  let state = { count: 0, lastAt: 0 };
  let now = 1_000;
  let toggled: boolean | null = null;
  for (let index = 0; index < times; index += 1) {
    now += gapMs;
    const next = registerClick(state, now, enabled);
    state = { count: next.count, lastAt: next.lastAt };
    toggled = next.toggled;
  }
  return { state, toggled };
}

describe("registerClick", () => {
  it("says nothing until the run is complete", () => {
    for (let times = 1; times < CLICKS_TO_TOGGLE; times += 1) {
      expect(clickRun(times).toggled).toBeNull();
    }
  });

  it("turns developer mode on at the tenth click, and off with another ten", () => {
    expect(clickRun(CLICKS_TO_TOGGLE).toggled).toBe(true);
    expect(clickRun(CLICKS_TO_TOGGLE, true).toggled).toBe(false);
  });

  // Without the reset, every click after the tenth would flip the mode again,
  // landing on whichever state an enthusiastic run happened to stop on.
  it("starts a fresh tally once a run completes", () => {
    const { state } = clickRun(CLICKS_TO_TOGGLE);
    expect(state.count).toBe(0);

    const eleventh = registerClick(state, state.lastAt + 100, true);
    expect(eleventh.toggled).toBeNull();
    expect(eleventh.count).toBe(1);
  });

  // Clicks spread across a session are not a gesture.
  it("forgets a tally that went cold", () => {
    const stale = { count: CLICKS_TO_TOGGLE - 1, lastAt: 1_000 };
    const late = registerClick(stale, 1_000 + CLICK_WINDOW_MS + 1, false);

    expect(late.toggled).toBeNull();
    expect(late.count).toBe(1);
  });

  it("keeps counting while clicks stay inside the window", () => {
    const warm = { count: CLICKS_TO_TOGGLE - 1, lastAt: 1_000 };
    expect(registerClick(warm, 1_000 + CLICK_WINDOW_MS, false).toggled).toBe(true);
  });
});

describe("the stored flag", () => {
  beforeEach(() => localStorage.clear());

  it("is off until it is turned on, and forgotten when turned off", () => {
    expect(developerModeEnabled()).toBe(false);

    setDeveloperMode(true);
    expect(developerModeEnabled()).toBe(true);

    setDeveloperMode(false);
    expect(developerModeEnabled()).toBe(false);
    // Removed rather than stored as "false", so a browser that never used the
    // gesture carries nothing.
    expect(localStorage.getItem("musubi-developer")).toBeNull();
  });

  // Private mode, or storage the browser refuses. Losing the flag is fine;
  // throwing while reading it would take the settings dialog down with it.
  it("survives storage that throws", () => {
    const broken = () => {
      throw new Error("denied");
    };
    const original = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    ) as PropertyDescriptor;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: broken, removeItem: broken, setItem: broken },
    });

    expect(developerModeEnabled()).toBe(false);
    expect(() => setDeveloperMode(true)).not.toThrow();

    Object.defineProperty(window, "localStorage", original);
  });
});
