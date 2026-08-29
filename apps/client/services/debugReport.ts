// The I/O half of the debug screen: run the checks, gather the state, and turn
// both into text somebody can paste into a bug report.
//
// The judgement lives next door in `lib/healthChecks.ts`, which imports nothing
// from Expo and is tested on its own. This file is the part that talks to the
// network, the OS and SQLite, and it is deliberately dumb: every check catches
// its own failure and turns it into a `fail` result, because a debug screen
// that throws while diagnosing is worse than no debug screen.

import Constants from "expo-constants";
import { Platform } from "react-native";
import { count } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { eventsTable, notificationsTable } from "@/db/schema";
import { db } from "./db";
import { cacheGetCalendars, getLastSync } from "./eventsCache";
import { reminderDiagnostics, type ReminderDiagnostics } from "./notifications";
import {
  clientVersionVerdict,
  clockSkewVerdict,
  formatChecks,
  permissionVerdict,
  reachabilityVerdict,
  reminderRulesVerdict,
  scheduleDriftVerdict,
  summarise,
  type CheckResult,
} from "@/lib/healthChecks";
import { fetchWithTimeout } from "@/lib/network";
import { getServerDiagnostics } from "@/lib/serverDiagnostics";

/** Anything a session-shaped answer might carry. */
type SessionLike = { data?: { user?: { id?: string; email?: string } } | null };

export type ServerProbe = {
  ok: boolean;
  status: number | null;
  ms: number;
  error?: string;
  /** The parsed body, kept so the screen can show the shape it answered with. */
  body?: unknown;
  /** The server's own clock, from the HTTP `Date` header. */
  serverTime?: string;
};

export type DebugSnapshot = {
  checks: CheckResult[];
  app: { version: string; build: string; platform: string };
  server: { url: string; probe: ServerProbe };
  session: { signedIn: boolean; userId: string | null; error: string | null };
  local: { events: number; calendars: number; receipts: number; lastSync: string | null; error: string | null };
  reminders: ReminderDiagnostics | null;
  requests: string;
};

const PROBE_TIMEOUT_MS = 8_000;

/**
 * Ask the server who it is, and time the round trip.
 *
 * `/api/v1/server` rather than `/server/ok`: it is the document every client
 * reads first, so its *shape* is what a wire problem shows up in, and its
 * `Date` header gives the clock comparison for free.
 */
export async function probeServer(apiUrl: string): Promise<ServerProbe> {
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(
      `${apiUrl}/api/v1/server`,
      { headers: { accept: "application/json" } },
      PROBE_TIMEOUT_MS,
    );
    const ms = Date.now() - startedAt;
    const serverTime = response.headers.get("date") ?? undefined;

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // A reachable server that answers something other than JSON is exactly
      // the case worth seeing — a captive portal, or a proxy serving HTML.
      body = { error: "The response was not JSON." };
    }

    return { body, ms, ok: response.ok, serverTime, status: response.status };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - startedAt,
      ok: false,
      status: null,
    };
  }
}

/** How far this device's clock is from the server's, or null when unknown. */
function clockSkewMs(probe: ServerProbe): number | null {
  if (!probe.serverTime) return null;
  const server = Date.parse(probe.serverTime);
  if (Number.isNaN(server)) return null;
  // The round trip is not instant, so half of it is the fairest correction —
  // otherwise every probe reads as a device that is behind by the latency.
  return Date.now() - (server + probe.ms / 2);
}

async function countRows(table: SQLiteTable) {
  const [row] = await db.select({ value: count() }).from(table);
  return row?.value ?? 0;
}

export async function collectDebugSnapshot(input: {
  apiUrl: string;
  getSession: () => Promise<SessionLike>;
}): Promise<DebugSnapshot> {
  const version =
    Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "unknown";
  const build =
    Constants.nativeBuildVersion ??
    String(
      Platform.OS === "android"
        ? Constants.expoConfig?.android?.versionCode ?? "dev"
        : "dev",
    );

  const probe = await probeServer(input.apiUrl);

  // Signed out is not a fault by itself, but it explains almost everything
  // downstream — no rules, no events, no reminders.
  let session: DebugSnapshot["session"] = {
    error: null,
    signedIn: false,
    userId: null,
  };
  try {
    const result = await input.getSession();
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

  // A migration that did not apply shows up here as a query that throws, which
  // is the honest way to ask "does the local database still work".
  let local: DebugSnapshot["local"] = {
    calendars: 0,
    error: null,
    events: 0,
    lastSync: null,
    receipts: 0,
  };
  try {
    // Calendars are one JSON blob in `sync_meta`, not a table of their own.
    const [events, calendars, receipts, lastSync] = await Promise.all([
      countRows(eventsTable),
      cacheGetCalendars(),
      countRows(notificationsTable),
      getLastSync(),
    ]);
    local = { calendars: calendars.length, error: null, events, lastSync, receipts };
  } catch (error) {
    local = {
      calendars: 0,
      error: error instanceof Error ? error.message : String(error),
      events: 0,
      lastSync: null,
      receipts: 0,
    };
  }

  const reminders = await reminderDiagnostics().catch(() => null);

  const identity = (probe.body ?? {}) as {
    minClientVersion?: unknown;
    version?: unknown;
  };
  const minClientVersion =
    typeof identity.minClientVersion === "string"
      ? identity.minClientVersion
      : null;

  const checks: CheckResult[] = [
    reachabilityVerdict(probe.ok, probe.status, probe.ms, probe.error),
    {
      detail: session.error
        ? `Could not be read: ${session.error}`
        : session.signedIn
          ? "Signed in."
          : "Signed out, so nothing syncs and no reminder is scheduled.",
      id: "session",
      label: "Authentication",
      status: session.signedIn ? "pass" : "fail",
    },
    {
      detail: local.error
        ? `The local database refused a read: ${local.error}`
        : `${local.events} events, ${local.calendars} calendars cached.`,
      id: "local-db",
      label: "Local database",
      status: local.error ? "fail" : "pass",
    },
    clientVersionVerdict(version, probe.ok ? minClientVersion : null),
  ];

  const skew = clockSkewMs(probe);
  if (skew !== null) checks.push(clockSkewVerdict(skew));

  if (reminders) {
    checks.push(
      permissionVerdict(reminders.permission, reminders.canAskAgain),
      reminderRulesVerdict(reminders.rulesLoaded),
      scheduleDriftVerdict(reminders.receipts, reminders.scheduled),
    );
  } else {
    checks.push({
      detail: "Could not be read from the OS.",
      id: "reminders",
      label: "Reminder state",
      status: "fail",
    });
  }

  return {
    app: { build, platform: `${Platform.OS} ${String(Platform.Version)}`, version },
    checks,
    local,
    reminders,
    requests: getServerDiagnostics(),
    server: { probe, url: input.apiUrl },
    session,
  };
}

/** The whole snapshot as pasteable text, verdicts first. */
export function buildReport(snapshot: DebugSnapshot) {
  const { app, local, reminders, server, session } = snapshot;
  return [
    `Musubi ${app.version} (${app.build}) on ${app.platform}`,
    `Checks: ${summarise(snapshot.checks)}`,
    "",
    formatChecks(snapshot.checks),
    "",
    `Server: ${server.url}`,
    `  status ${server.probe.status ?? "none"} in ${server.probe.ms} ms`,
    ...(server.probe.error ? [`  error: ${server.probe.error}`] : []),
    `  answered: ${JSON.stringify(server.probe.body ?? null)}`,
    `Session: ${session.signedIn ? `signed in (${session.userId})` : "signed out"}`,
    `Local: ${local.events} events, ${local.calendars} calendars, ${local.receipts} receipts`,
    `  last sync: ${local.lastSync ?? "never"}`,
    ...(local.error ? [`  error: ${local.error}`] : []),
    reminders
      ? `Reminders: permission ${reminders.permission}, ${reminders.scheduled} scheduled, rules ${reminders.rulesLoaded ? "loaded" : "MISSING"}`
      : "Reminders: unreadable",
    ...(reminders?.nextScheduled.length
      ? [`  next: ${reminders.nextScheduled.join(", ")}`]
      : []),
    ...(reminders?.channels.length
      ? [
          `  channels: ${reminders.channels
            .map((channel) => `${channel.id} — ${channel.importance}`)
            .join(", ")}`,
        ]
      : []),
    "",
    "Requests:",
    snapshot.requests,
  ].join("\n");
}
