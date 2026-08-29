// The I/O half of diagnostics: probe, read the browser, and turn both into a
// verdict list and a pasteable report.
//
// Every reader here catches its own failure and turns it into a `fail` result.
// A diagnostics dialog that throws while diagnosing is worse than none, and the
// state it is inspecting is exactly the state most likely to be broken.

import musubiPackage from "../../../../package.json";
import { authClient } from "~/auth/auth-client";
import { getPushSubscriptions } from "~/api/resources";
import {
  currentSubscription,
  fingerprintEndpoint,
  pushSupported,
} from "~/push/subscribe";
import {
  bundleVersionVerdict,
  clockSkewVerdict,
  formatChecks,
  permissionVerdict,
  pushVerdict,
  reachabilityVerdict,
  reminderRulesVerdict,
  serverKnowsBrowserVerdict,
  serviceWorkerVerdict,
  summarise,
  type CheckResult,
} from "./checks";

/** What this bundle was built from. Vite inlines it; there is no fetch. */
const BUILD_VERSION = musubiPackage.version;

const PROBE_TIMEOUT_MS = 8_000;

export type ServerProbe = {
  ok: boolean;
  status: number | null;
  ms: number;
  error?: string;
  /** The parsed body, kept so the dialog can show the shape it answered with. */
  body?: unknown;
  /** The server's own clock, from the HTTP `Date` header. */
  serverTime?: string;
};

export type Snapshot = {
  checks: CheckResult[];
  app: { bundle: string; origin: string; timezone: string; userAgent: string };
  server: ServerProbe;
  session: { signedIn: boolean; userId: string | null; error: string | null };
  notifications: {
    permission: NotificationPermission | "unsupported";
    pushSupported: boolean;
    serverCapable: boolean;
    subscribed: boolean;
    endpointHost: string | null;
    serviceWorkerScope: string | null;
    /** How many registrations the server holds, or null when it could not say. */
    serverRegistrations: number | null;
    /** Whether the server's list contains this browser. Null when unknown. */
    serverKnowsThisBrowser: boolean | null;
  };
};

/**
 * Ask the server who it is, and time the round trip.
 *
 * `/api/v1/server` rather than a dedicated health route: it is the document
 * every client reads first, so a wire problem shows up in its *shape*, and its
 * `Date` header gives the clock comparison for free.
 *
 * A bare `fetch`, not the app's `apiRequest`, because a schema failure is one
 * of the things being diagnosed — parsing here would hide it.
 */
export async function probeServer(): Promise<ServerProbe> {
  const startedAt = Date.now();
  try {
    const response = await fetch("/api/v1/server", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const ms = Date.now() - startedAt;

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // A reachable server answering something other than JSON is exactly the
      // case worth seeing — a captive portal, or a proxy serving HTML.
      body = { error: "The response was not JSON." };
    }

    return {
      body,
      ms,
      ok: response.ok,
      serverTime: response.headers.get("date") ?? undefined,
      status: response.status,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - startedAt,
      ok: false,
      status: null,
    };
  }
}

/** How far this browser's clock is from the server's, or null when unknown. */
function clockSkewMs(probe: ServerProbe): number | null {
  if (!probe.serverTime) return null;
  const server = Date.parse(probe.serverTime);
  if (Number.isNaN(server)) return null;
  // The round trip is not instant, so half of it is the fairest correction —
  // otherwise every probe reads as a browser behind by the latency.
  return Date.now() - (server + probe.ms / 2);
}

/**
 * The push endpoint's host, and only its host.
 *
 * A push endpoint is a capability URL: anyone holding it can send this browser
 * a notification. The host says which push service is in use, which is the part
 * worth diagnosing, and none of the part worth protecting — and this string
 * ends up in reports people paste into issues.
 */
function endpointHost(endpoint: string | undefined) {
  if (!endpoint) return null;
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}

async function serviceWorkerScope() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration("/app/");
    return registration?.scope ?? null;
  } catch {
    return null;
  }
}

export async function collectSnapshot(input: {
  /** Whether the reminder rules the resolver needs have arrived. */
  remindersLoaded: boolean;
}): Promise<Snapshot> {
  const probe = await probeServer();

  let session: Snapshot["session"] = {
    error: null,
    signedIn: false,
    userId: null,
  };
  try {
    const result = await authClient.getSession();
    session = {
      error: null,
      signedIn: Boolean(result.data?.user?.id),
      userId: result.data?.user?.id ?? null,
    };
  } catch (error) {
    session = {
      error: error instanceof Error ? error.message : String(error),
      signedIn: false,
      userId: null,
    };
  }

  const supported = pushSupported();
  const subscription = await currentSubscription();
  const capabilities = (probe.body ?? {}) as {
    pushPublicKey?: unknown;
    version?: unknown;
  };
  const serverCapable =
    typeof capabilities.pushPublicKey === "string" &&
    capabilities.pushPublicKey.length > 0;
  const served =
    typeof capabilities.version === "string" ? capabilities.version : null;

  // Only worth asking when this browser holds something to match, and only
  // when signed in — the route needs a session.
  const serverFingerprints =
    subscription && session.signedIn
      ? await getPushSubscriptions()
          .then((answer) => answer.subscriptions.map((row) => row.fingerprint))
          .catch(() => null)
      : null;
  const fingerprint = subscription
    ? await fingerprintEndpoint(subscription.endpoint)
    : null;

  const notifications: Snapshot["notifications"] = {
    endpointHost: endpointHost(subscription?.endpoint),
    permission:
      typeof Notification === "undefined"
        ? "unsupported"
        : Notification.permission,
    pushSupported: supported,
    serverCapable,
    serverKnowsThisBrowser:
      serverFingerprints && fingerprint
        ? serverFingerprints.includes(fingerprint)
        : null,
    serverRegistrations: serverFingerprints?.length ?? null,
    serviceWorkerScope: await serviceWorkerScope(),
    subscribed: Boolean(subscription),
  };

  const checks: CheckResult[] = [
    reachabilityVerdict(probe.ok, probe.status, probe.ms, probe.error),
    {
      detail: session.error
        ? `Could not be read: ${session.error}`
        : session.signedIn
          ? "Signed in."
          : "Signed out, so nothing syncs and no reminder is resolved.",
      id: "session",
      label: "Authentication",
      status: session.signedIn ? "pass" : "fail",
    },
    bundleVersionVerdict(BUILD_VERSION, probe.ok ? served : null),
    permissionVerdict(notifications.permission),
    pushVerdict({ serverCapable, subscribed: Boolean(subscription), supported }),
    serverKnowsBrowserVerdict({
      fingerprint,
      serverFingerprints,
      subscribed: Boolean(subscription),
    }),
    serviceWorkerVerdict(notifications.serviceWorkerScope, supported),
    reminderRulesVerdict(input.remindersLoaded),
  ];

  const skew = clockSkewMs(probe);
  if (skew !== null) checks.push(clockSkewVerdict(skew));

  return {
    app: {
      bundle: BUILD_VERSION,
      origin: window.location.origin,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      userAgent: navigator.userAgent,
    },
    checks,
    notifications,
    server: probe,
    session,
  };
}

/** The whole snapshot as pasteable text, verdicts first. */
export function buildReport(snapshot: Snapshot) {
  const { app, notifications, server, session } = snapshot;
  return [
    `Musubi web ${app.bundle} at ${app.origin}`,
    `Checks: ${summarise(snapshot.checks)}`,
    "",
    formatChecks(snapshot.checks),
    "",
    `Browser: ${app.userAgent}`,
    `Timezone: ${app.timezone}`,
    `Session: ${session.signedIn ? `signed in (${session.userId})` : "signed out"}`,
    "",
    `Server: status ${server.status ?? "none"} in ${server.ms} ms`,
    ...(server.error ? [`  error: ${server.error}`] : []),
    `  answered: ${JSON.stringify(server.body ?? null)}`,
    "",
    `Notifications: permission ${notifications.permission}`,
    `  push supported ${notifications.pushSupported}, server capable ${notifications.serverCapable}, subscribed ${notifications.subscribed}`,
    // Host only — the full endpoint is a capability URL and this text gets
    // pasted into issues.
    `  push service: ${notifications.endpointHost ?? "none"}`,
    `  server registrations: ${notifications.serverRegistrations ?? "unknown"}, this browser among them: ${notifications.serverKnowsThisBrowser ?? "unknown"}`,
    `  service worker: ${notifications.serviceWorkerScope ?? "not registered"}`,
  ].join("\n");
}
