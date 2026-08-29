// Whether the diagnostics section is showing, and the ten-click gesture that
// toggles it.
//
// Per browser, in `localStorage`, for the same reason the phone keeps its copy
// on the device: turning diagnostics on here should not turn them on for
// somebody's other machine, and it is not a preference worth a settings
// revision or a round trip.

const KEY = "musubi-developer";

/** How many clicks on the version row it takes, in either direction. */
export const CLICKS_TO_TOGGLE = 10;

/**
 * Start counting again after a pause.
 *
 * Without this, clicks accumulate for as long as the tab is open — three today
 * and seven tomorrow would toggle a mode nobody meant to touch.
 */
export const CLICK_WINDOW_MS = 3_000;

export type ClickState = { count: number; lastAt: number };

/**
 * What a click on the version row does.
 *
 * The caller keeps the tally; this decides what it becomes. `toggled` is null
 * until the run completes, then carries the new state.
 */
export function registerClick(
  state: ClickState,
  now: number,
  enabled: boolean,
): ClickState & { toggled: boolean | null } {
  const continuing = now - state.lastAt <= CLICK_WINDOW_MS;
  const count = (continuing ? state.count : 0) + 1;

  if (count < CLICKS_TO_TOGGLE) return { count, lastAt: now, toggled: null };
  // Reset on completion, so the next ten toggle back rather than every click
  // after the tenth flipping it again.
  return { count: 0, lastAt: now, toggled: !enabled };
}

export function developerModeEnabled() {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    // Private mode, or storage the browser will not hand over.
    return false;
  }
}

export function setDeveloperMode(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(KEY, "true");
    else localStorage.removeItem(KEY);
  } catch {
    // The toggle still works for this tab; it just will not be remembered.
  }
}
