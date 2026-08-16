import assert from "node:assert/strict";
import { dispatchWindow, MAX_CATCHUP_MS } from "./reminder_dispatch";

// The window is the whole correctness story of the dispatcher: it decides
// whether a restart sends a reminder twice, misses it, or announces a stack of
// meetings that already happened. The sending itself is a library call.

const NOW = new Date("2026-08-16T09:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() - n * 60_000);

{
  // The ordinary tick: carry on from where the last one stopped, so nothing
  // between the two runs falls through the gap.
  const window = dispatchWindow(minutes(1), NOW);
  assert.equal(window.from.toISOString(), minutes(1).toISOString());
  assert.equal(window.to.toISOString(), NOW.toISOString());
  assert.equal(window.skipped, false);
}

{
  // An outage. Everything older than the catch-up limit is dropped on purpose:
  // "your 7am stood up two hours ago" is worse than saying nothing.
  const window = dispatchWindow(minutes(240), NOW);
  assert.equal(window.from.getTime(), NOW.getTime() - MAX_CATCHUP_MS);
  assert.equal(window.skipped, true, "the drop has to be visible in the log");
}

{
  // A fresh install, or a wiped cursor. Without the clamp this would send every
  // reminder every user has ever had, all at once.
  const window = dispatchWindow(null, NOW);
  assert.equal(window.from.getTime(), NOW.getTime() - MAX_CATCHUP_MS);
  assert.equal(window.skipped, false, "a first run is not an outage");
}

{
  // A cursor ahead of the clock — NTP stepped backwards, or somebody restored a
  // database. Trusting it would make `from > to` and go quiet until real time
  // caught up, which on a big correction is hours of silence nobody explains.
  const window = dispatchWindow(new Date(NOW.getTime() + 3_600_000), NOW);
  assert.equal(window.from.getTime(), NOW.getTime() - MAX_CATCHUP_MS);
  assert.ok(window.from < window.to);
}

{
  // Exactly at the boundary stays whole rather than being treated as an outage.
  const window = dispatchWindow(new Date(NOW.getTime() - MAX_CATCHUP_MS), NOW);
  assert.equal(window.skipped, false);
  assert.equal(window.from.getTime(), NOW.getTime() - MAX_CATCHUP_MS);
}

{
  // Windows must abut, never overlap: yesterday's `to` is today's `from`, so no
  // occurrence lands in two consecutive passes and gets pushed twice.
  const first = dispatchWindow(minutes(2), NOW);
  const later = new Date(NOW.getTime() + 60_000);
  const second = dispatchWindow(first.to, later);
  assert.equal(second.from.getTime(), first.to.getTime());
}

console.log("reminder_dispatch.test.ts ok");
