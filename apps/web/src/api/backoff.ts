/**
 * How long to wait before the next reconnect attempt.
 *
 * Exponential so a server that is down is not hammered, jittered so a thousand
 * tabs that dropped together do not come back in lockstep and knock it over
 * again (`07-realtime-offline-federation.md:38-61`).
 *
 * `random` is a parameter so the schedule can be asserted rather than guessed at.
 */
export function reconnectDelay(
  attempt: number,
  {
    baseMs = 1_000,
    jitter = Math.random,
    maxMs = 30_000,
  }: { baseMs?: number; jitter?: () => number; maxMs?: number } = {},
) {
  const step = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  // Full jitter over the window rather than a small wobble around it: the point
  // is to spread a herd, and a floor keeps the first retry from being instant.
  return Math.round(step / 2 + jitter() * (step / 2));
}
