// The ten-tap gesture that shows or hides the diagnostics entry point.
//
// Pure, and separate from where the flag is stored, so the counting rules are
// testable without a device — the same split as `healthChecks.ts` next door.
// The storage lives in `services/developerMode.ts`.

/** How many taps on the version row it takes, in either direction. */
export const TAPS_TO_TOGGLE = 10;

/**
 * Start counting again after a pause.
 *
 * Without this, taps accumulate across a whole session — three today and seven
 * next week would toggle a mode nobody meant to touch. The window is generous
 * enough for deliberate tapping and short enough that idle presses expire.
 */
export const TAP_WINDOW_MS = 3_000;

export type TapState = { count: number; lastAt: number };

/**
 * What a tap on the version row does.
 *
 * The caller keeps the tally and the timestamp; this decides what they become.
 * `toggled` is null until the run completes, then carries the new state — the
 * caller persists it and says so.
 */
export function registerTap(
  state: TapState,
  now: number,
  enabled: boolean,
): TapState & { toggled: boolean | null } {
  const continuing = now - state.lastAt <= TAP_WINDOW_MS;
  const count = (continuing ? state.count : 0) + 1;

  if (count < TAPS_TO_TOGGLE) return { count, lastAt: now, toggled: null };
  // Reset the tally on completion, so the next ten toggle back rather than
  // every tap after the tenth flipping it again.
  return { count: 0, lastAt: now, toggled: !enabled };
}
