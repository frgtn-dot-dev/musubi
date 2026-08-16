import type { ResolvedReminder } from "@musubi/calendar";

/**
 * Turn resolved reminders into browser timers.
 *
 * The web can only ring while a tab is open — a browser gives no way to wake a
 * closed page without a service worker and a push subscription, which is a
 * later phase. So this is deliberately modest: it announces what falls due
 * while somebody is looking, and never pretends to more.
 */

// `setTimeout` stores its delay in a signed 32-bit int: anything beyond ~24.8
// days overflows and fires IMMEDIATELY. A reminder that arrives three weeks
// early is worse than one that never arrives, so long waits are chained.
const MAX_DELAY_MS = 2_147_483_647;

export type ReminderNotifier = (reminder: ResolvedReminder) => void;

export function scheduleReminders(
  reminders: readonly ResolvedReminder[],
  notify: ReminderNotifier,
  now: number = Date.now(),
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];

  for (const reminder of reminders) {
    const delay = reminder.dueAt.getTime() - now;
    // Already due. Firing it now would announce a meeting that has started,
    // and the resolver has already dropped anything genuinely in the past.
    if (delay < 0) continue;

    const arm = (remaining: number) => {
      const timer = setTimeout(
        () => {
          const left = remaining - MAX_DELAY_MS;
          if (left > 0) arm(left);
          else notify(reminder);
        },
        Math.min(remaining, MAX_DELAY_MS),
      );
      timers.push(timer);
    };
    arm(delay);
  }

  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
}

/**
 * Show one reminder, if the user has agreed to be shown any.
 *
 * Never asks here: permission is requested where somebody is turning a reminder
 * ON, not the first time one happens to come due. A prompt with no context is
 * the one people click away forever.
 */
export function notifyReminder(reminder: ResolvedReminder) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  new Notification(reminder.title, {
    body: reminder.occurrenceStart.toLocaleString(undefined, {
      dateStyle: "medium",
      ...(reminder.isAllDay ? {} : { timeStyle: "short" }),
    }),
    // One notification per occurrence: re-running the scheduler after a refetch
    // must replace the pending one rather than stack a second copy.
    tag: reminder.occurrenceID,
  });
}

/** Ask, in the moment somebody switches a reminder on. */
export async function requestReminderPermission() {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}
