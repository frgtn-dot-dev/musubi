// The verdicts the diagnostics dialog reports.
//
// Pure, and separate from the collecting, so the judgement is testable without
// a browser. The failures they cover are all quiet ones — a reminder that never
// appears could be a permission the browser never asked for, a service worker
// that 404s, a subscription the server dropped, a clock two minutes out, or a
// tab running last week's bundle. None of those announces itself, and from the
// outside they look identical.
//
// This is deliberately not shared with the phone's copy in `apps/client`. The
// two apps answer different questions — service workers and push subscriptions
// here, OS channels and alarm receipts there — and only the scaffolding is
// common. Two small copies beat a package that exists to hold thirty lines.

export type CheckStatus = "pass" | "warn" | "fail";

export type CheckResult = {
  id: string;
  label: string;
  status: CheckStatus;
  /** One line, shown under the label and included in the report. */
  detail: string;
};

// --- Reaching the server ----------------------------------------------------

/** Past this, something between the tab and the server is worth looking at. */
const SLOW_MS = 2_000;

export function reachabilityVerdict(
  ok: boolean,
  status: number | null,
  ms: number,
  error?: string,
): CheckResult {
  if (!ok) {
    return {
      detail: error ?? `The server answered ${status ?? "nothing"}.`,
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

// --- Clocks -----------------------------------------------------------------

/**
 * How far the browser clock may drift before reminders land wrong.
 *
 * In-tab reminders are scheduled against this clock, so its error is theirs.
 * Server-pushed ones are not affected, which is why this warns rather than
 * fails until the gap is one a person would notice.
 */
const SKEW_WARN_MS = 30_000;
const SKEW_FAIL_MS = 120_000;

export function clockSkewVerdict(skewMs: number): CheckResult {
  const magnitude = Math.abs(skewMs);
  const seconds = Math.round(magnitude / 1000);
  const direction = skewMs > 0 ? "ahead of" : "behind";
  const detail =
    magnitude < 1000
      ? "Browser clock matches the server."
      : `Browser clock is ${seconds}s ${direction} the server.`;

  return {
    detail:
      magnitude >= SKEW_FAIL_MS
        ? `${detail} In-tab reminders will appear at the wrong time.`
        : detail,
    id: "clock",
    label: "Browser clock",
    status:
      magnitude >= SKEW_FAIL_MS
        ? "fail"
        : magnitude >= SKEW_WARN_MS
          ? "warn"
          : "pass",
  };
}

// --- Versions ---------------------------------------------------------------

const rank = (version: string) => version.split(".").map(Number);

/** Numeric, because "0.1.10" sorts before "0.1.9" as a string. */
function isAhead(candidate: string, reference: string) {
  const [a = 0, b = 0, c = 0] = rank(candidate);
  const [x = 0, y = 0, z = 0] = rank(reference);
  return a > x || (a === x && (b > y || (b === y && c > z)));
}

/**
 * Whether this tab is still the code the server expects.
 *
 * A tab outlives a deploy — people leave Musubi open for days — and the
 * JavaScript running is whatever was current when it opened. A server *behind*
 * the tab is the ordinary self-hosting case and says nothing.
 */
export function bundleVersionVerdict(
  bundle: string,
  served: string | null,
): CheckResult {
  if (!served) {
    return {
      detail: `This tab is running ${bundle}. The server named no version.`,
      id: "bundle",
      label: "App version",
      status: "warn",
    };
  }
  if (isAhead(served, bundle)) {
    return {
      detail: `This tab is running ${bundle}, the server is on ${served}. Reload to catch up.`,
      id: "bundle",
      label: "App version",
      status: "warn",
    };
  }
  return {
    detail: `Running ${bundle}, server on ${served}.`,
    id: "bundle",
    label: "App version",
    status: "pass",
  };
}

// --- Notifications ----------------------------------------------------------

/**
 * The browser's own permission, which has a third state the phone does not.
 *
 * "default" means nothing has ever asked — the prompt is still available, and
 * the fix is a click. "denied" means it was refused, and only the site settings
 * can undo that. Saying which is the whole value of this check.
 */
export function permissionVerdict(
  permission: NotificationPermission | "unsupported",
): CheckResult {
  if (permission === "granted") {
    return {
      detail: "Granted.",
      id: "permission",
      label: "Notification permission",
      status: "pass",
    };
  }
  if (permission === "unsupported") {
    return {
      detail: "This browser has no Notification API, so reminders cannot be shown at all.",
      id: "permission",
      label: "Notification permission",
      status: "fail",
    };
  }
  return {
    detail:
      permission === "default"
        ? "Never asked. Turn reminders on in Settings and the browser will prompt."
        : "Refused. Only this site's browser settings can grant it now.",
    id: "permission",
    label: "Notification permission",
    status: "fail",
  };
}

export type PushState = {
  /** Service workers and the Push API, both present. */
  supported: boolean;
  /** The server published a VAPID key, so it can push at all. */
  serverCapable: boolean;
  /** This browser holds a subscription. */
  subscribed: boolean;
};

/**
 * Whether reminders survive the tab being closed.
 *
 * Not being subscribed is a choice, not a fault — in-tab reminders are the
 * documented fallback. It warns rather than passing because "reminders only
 * while a tab is open" is the single most common reason somebody says they
 * never arrived.
 */
export function pushVerdict({
  serverCapable,
  subscribed,
  supported,
}: PushState): CheckResult {
  const base = { id: "push", label: "Push delivery" } as const;

  if (!supported) {
    return {
      ...base,
      detail:
        "This browser cannot receive push. Reminders appear only while a tab is open.",
      status: "warn",
    };
  }
  if (!serverCapable) {
    return {
      ...base,
      detail:
        "This server has no push keys configured, so it never pushes. Reminders appear only while a tab is open.",
      status: "warn",
    };
  }
  if (!subscribed) {
    return {
      ...base,
      detail:
        'Not subscribed. Turn on "Notify me when this browser is closed" in Settings.',
      status: "warn",
    };
  }
  return { ...base, detail: "Subscribed on this browser.", status: "pass" };
}

/**
 * The worker that shows a pushed reminder.
 *
 * It is served, not bundled, and the gateway routes only `/app/*` to this app —
 * so a misrouted deploy answers the worker's own URL with the marketing site,
 * registration throws, and the failure is swallowed as "the browser refused
 * notifications". Naming it here separates a routing fault from a refusal.
 */
export function serviceWorkerVerdict(
  scope: string | null,
  supported: boolean,
): CheckResult {
  const base = { id: "service-worker", label: "Service worker" } as const;

  if (!supported) {
    return { ...base, detail: "Not supported by this browser.", status: "warn" };
  }
  if (!scope) {
    return {
      ...base,
      detail:
        "Not registered. Push cannot be delivered; if this persists, /app/sw.js may not be reachable.",
      status: "warn",
    };
  }
  return { ...base, detail: `Registered for ${scope}.`, status: "pass" };
}

/**
 * What the server holds against what this browser holds.
 *
 * `null` for either side means the question could not be asked — the read
 * failed, or `crypto.subtle` is unavailable — and an unknown answer must not
 * read as a good one.
 *
 * The state this exists for is the last branch: a browser holding a
 * subscription the server does not have. It happens whenever a send comes back
 * 410 and the row is dropped, which the browser is never told about. Until this
 * check there was nothing anywhere that could see it.
 */
export function serverKnowsBrowserVerdict(input: {
  fingerprint: string | null;
  serverFingerprints: string[] | null;
  subscribed: boolean;
}): CheckResult {
  const base = { id: "push-registration", label: "Server registration" } as const;

  if (!input.subscribed) {
    return {
      ...base,
      detail: "This browser holds no subscription, so there is nothing to match.",
      status: "warn",
    };
  }
  if (!input.serverFingerprints) {
    return {
      ...base,
      detail: "The server's list could not be read, so this is unknown.",
      status: "warn",
    };
  }
  if (!input.fingerprint) {
    return {
      ...base,
      detail:
        "This browser cannot hash its endpoint, so it cannot find itself in the list.",
      status: "warn",
    };
  }
  if (input.serverFingerprints.includes(input.fingerprint)) {
    return {
      ...base,
      detail: `The server has this browser${input.serverFingerprints.length > 1 ? `, and ${input.serverFingerprints.length - 1} other` : ""}.`,
      status: "pass",
    };
  }
  return {
    ...base,
    detail:
      "This browser is subscribed but the server has no matching registration — it was dropped after a failed push. Turn reminders off and on again in Settings.",
    status: "fail",
  };
}

/** Without rules nothing resolves, so no reminder is ever due. */
export function reminderRulesVerdict(loaded: boolean): CheckResult {
  return {
    detail: loaded
      ? "Loaded."
      : "Not loaded, so no reminder can be resolved. Check the server is reachable.",
    id: "reminder-rules",
    label: "Reminder rules",
    status: loaded ? "pass" : "fail",
  };
}

// --- Report -----------------------------------------------------------------

const MARK: Record<CheckStatus, string> = {
  fail: "FAIL",
  pass: "ok",
  warn: "WARN",
};

/** The checks as text, for the shared report. Worst first. */
export function formatChecks(results: CheckResult[]) {
  const order: Record<CheckStatus, number> = { fail: 0, pass: 2, warn: 1 };
  return [...results]
    .sort((left, right) => order[left.status] - order[right.status])
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

/** The worst thing in the run — what the summary is coloured by. */
export function worstStatus(results: CheckResult[]): CheckStatus {
  if (results.some((result) => result.status === "fail")) return "fail";
  if (results.some((result) => result.status === "warn")) return "warn";
  return "pass";
}
