// Checks that run the moment the debug screen opens.
//
// The point is not to gather more numbers — the panel already shows plenty. It
// is to turn a wall of state into a verdict, because the failures this app has
// are all silent ones and they look identical from the outside: a reminder that
// never arrives could be a missing permission, rules that never loaded, an OS
// that dropped the alarms, or a clock two minutes off. Each of those is a
// different fix and none of them announces itself.
//
// So each check ends in pass / warn / fail with the reason attached, and the
// shared report carries the verdicts rather than making the reader derive them.
//
// The verdicts are pure functions, separately testable, because that is where
// the judgement lives — `healthChecks.spec.ts` covers them. Everything around
// them is I/O.

import { compareVersions } from "@musubi/types";

export type CheckStatus = "pass" | "warn" | "fail";

export type CheckResult = {
  id: string;
  label: string;
  status: CheckStatus;
  /** One line, shown under the label and included in the report. */
  detail: string;
};

// --- Verdicts ---------------------------------------------------------------

/**
 * How far the device clock may drift before reminders land wrong.
 *
 * Reminders are scheduled locally against this clock, so its error is the
 * reminder's error: a phone two minutes fast rings two minutes early, and one
 * an hour out is useless. Warn early, fail once it is visible to a human.
 */
const SKEW_WARN_MS = 30_000;
const SKEW_FAIL_MS = 120_000;

export function clockSkewVerdict(skewMs: number): CheckResult {
  const magnitude = Math.abs(skewMs);
  const seconds = Math.round(magnitude / 1000);
  const direction = skewMs > 0 ? "ahead of" : "behind";
  const detail =
    magnitude < 1000
      ? "Device clock matches the server."
      : `Device clock is ${seconds}s ${direction} the server.`;

  return {
    detail:
      magnitude >= SKEW_FAIL_MS
        ? `${detail} Reminders will fire at the wrong time.`
        : detail,
    id: "clock",
    label: "Device clock",
    status:
      magnitude >= SKEW_FAIL_MS
        ? "fail"
        : magnitude >= SKEW_WARN_MS
          ? "warn"
          : "pass",
  };
}

/**
 * Whether the OS still holds what this device thinks it scheduled.
 *
 * The receipts table is what the app believes; `getAllScheduledNotificationsAsync`
 * is what the system will actually fire. They drift apart when the OS drops
 * alarms — a force-stop on Android, or iOS trimming past its ~64 pending cap —
 * and nothing reports that. The app goes on believing the reminder is armed.
 */
export function scheduleDriftVerdict(
  receipts: number,
  scheduled: number,
): CheckResult {
  if (receipts === 0 && scheduled === 0) {
    return {
      detail: "Nothing scheduled. Expected when no upcoming event has a reminder.",
      id: "schedule-drift",
      label: "Scheduled reminders",
      status: "warn",
    };
  }
  if (scheduled === 0) {
    return {
      detail: `This device recorded ${receipts} reminder(s), but the system holds none. The OS dropped them.`,
      id: "schedule-drift",
      label: "Scheduled reminders",
      status: "fail",
    };
  }
  if (scheduled < receipts) {
    return {
      detail: `${scheduled} held by the system, ${receipts} recorded here — ${receipts - scheduled} were dropped.`,
      id: "schedule-drift",
      label: "Scheduled reminders",
      status: "warn",
    };
  }
  return {
    detail: `${scheduled} held by the system.`,
    id: "schedule-drift",
    label: "Scheduled reminders",
    status: "pass",
  };
}

/**
 * Whether this build is still one the server will talk to.
 *
 * The server refuses builds below `minClientVersion`, and the app shows a
 * blocking update screen for it — but only after a successful read. Saying it
 * here too costs nothing and covers the case where that check never ran.
 */
export function clientVersionVerdict(
  appVersion: string,
  minClientVersion: string | null,
): CheckResult {
  if (!minClientVersion) {
    return {
      detail: `App ${appVersion}. The server names no minimum.`,
      id: "client-version",
      label: "App version",
      status: "warn",
    };
  }
  const tooOld = compareVersions(appVersion, minClientVersion) < 0;
  return {
    detail: tooOld
      ? `App ${appVersion} is below the server's minimum of ${minClientVersion}. Update from the store.`
      : `App ${appVersion}, server accepts ${minClientVersion} and up.`,
    id: "client-version",
    label: "App version",
    status: tooOld ? "fail" : "pass",
  };
}

/** Permission is the first thing to fail and the easiest one to miss. */
export function permissionVerdict(
  permission: string,
  canAskAgain: boolean,
): CheckResult {
  if (permission === "granted") {
    return {
      detail: "Granted.",
      id: "permission",
      label: "Notification permission",
      status: "pass",
    };
  }
  return {
    detail: canAskAgain
      ? `Not granted (${permission}). Nothing has asked yet — use "Ask for permission" below.`
      : `Not granted (${permission}), and the system will not ask again. Grant it in system settings.`,
    id: "permission",
    label: "Notification permission",
    status: "fail",
  };
}

/**
 * The reconcile needs rules and returns silently without them.
 *
 * This is the second silent failure and the least obvious: everything else
 * looks healthy, the app is signed in and online, and no reminder is ever
 * handed to the OS because `syncScheduledReminders` left on its first line.
 */
export function reminderRulesVerdict(loaded: boolean): CheckResult {
  return {
    detail: loaded
      ? "Loaded."
      : "Not loaded, so no reminder is ever scheduled. Pull to refresh on the agenda, or check the server is reachable.",
    id: "reminder-rules",
    label: "Reminder rules",
    status: loaded ? "pass" : "fail",
  };
}

/** A reachable server, with how long it took. Slow is worth saying. */
const SLOW_MS = 2_000;

export function reachabilityVerdict(
  ok: boolean,
  status: number | null,
  ms: number,
  error?: string,
): CheckResult {
  if (!ok) {
    return {
      detail: error ?? `Server answered ${status ?? "nothing"}.`,
      id: "api",
      label: "API reachable",
      status: "fail",
    };
  }
  return {
    detail: `${status} in ${ms} ms${ms >= SLOW_MS ? " — slow" : ""}.`,
    id: "api",
    label: "API reachable",
    status: ms >= SLOW_MS ? "warn" : "pass",
  };
}

// --- Report -----------------------------------------------------------------

const MARK: Record<CheckStatus, string> = {
  fail: "FAIL",
  pass: "ok",
  warn: "WARN",
};

/** The checks as text, for the shared report. Verdicts first, worst first. */
export function formatChecks(results: CheckResult[]) {
  const rank: Record<CheckStatus, number> = { fail: 0, pass: 2, warn: 1 };
  return [...results]
    .sort((left, right) => rank[left.status] - rank[right.status])
    .map((result) => `[${MARK[result.status]}] ${result.label}: ${result.detail}`)
    .join("\n");
}

/** One line summarising the run, so the top of the report says the verdict. */
export function summarise(results: CheckResult[]) {
  const failed = results.filter((result) => result.status === "fail").length;
  const warned = results.filter((result) => result.status === "warn").length;
  if (failed > 0) return `${failed} failing, ${warned} warning`;
  if (warned > 0) return `all passing, ${warned} warning`;
  return "all passing";
}
