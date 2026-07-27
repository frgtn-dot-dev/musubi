// Federation (Musubi ↔ Musubi), client side.
//
// Since ADR-005 the app no longer holds member tokens. Everything for a
// connected server goes through the HOME server's gateway
// (`/api/v1/federation/s/:connectionId/...`), which attaches the credential
// itself and owns its rotation. The app only needs to know which calendars are
// remote and which connection they belong to.
//
// Registry lives here (not in a store) so services/api.ts can consult it
// without importing stores — the stores import useApi, which would cycle.
import * as SecureStore from "expo-secure-store";
import { Calendar, CalendarInvitePreview, Event } from "@musubi/types";
import { apiVersion } from "@/constants/url";

export type FederatedAccount = {
  id: string;      // connection id — the gateway's :connectionId
  label: string;   // host of the origin server, for grouping/labels
  server: string;  // origin server URL, e.g. https://musubi.example.com
  userID: string;  // our shadow-user id on that server
};

// No longer a secret (the member token stays on the server) — kept in
// SecureStore purely because that is where the registry already lived, and it
// still serves as the offline cache of which calendars are remote.
const STORE_KEY = "FEDERATED_ACCOUNTS";

let accounts: FederatedAccount[] = [];
let loaded = false;
// calendarID → owning connection; rebuilt on every sync so api.ts can route writes
const calendarOrigin = new Map<string, FederatedAccount>();

// Authenticated request against the HOME server, injected by useApi so this
// module stays free of store/context imports.
type HomeRequest = <T>(path: string, init?: RequestInit) => Promise<T>;
let homeRequest: HomeRequest | null = null;

export function setHomeRequester(request: HomeRequest) {
  homeRequest = request;
}

function requireHome(): HomeRequest {
  if (!homeRequest) {
    throw new Error("Federation is not ready: no home server request available.");
  }
  return homeRequest;
}

export async function loadFederatedAccounts(): Promise<FederatedAccount[]> {
  if (!loaded) {
    try {
      accounts = JSON.parse(await SecureStore.getItemAsync(STORE_KEY) ?? "[]");
    } catch {
      accounts = [];
    }
    // Drop pre-gateway entries: they carried a token and no connection id, and
    // without an id there is nothing to route through.
    accounts = accounts.filter(account => typeof account?.id === "string" && account.id);
    loaded = true;
  }
  return accounts;
}

async function persist() {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(accounts));
}

/**
 * Refresh the registry from the home server — the source of truth, so a
 * connection accepted on one device roams to all of them. SecureStore stays as
 * the offline fallback cache.
 */
export async function refreshFederatedAccounts(): Promise<FederatedAccount[]> {
  const connections = await requireHome()<FederatedAccount[]>(
    `/api/${apiVersion}/federation/connections`,
  );
  accounts = connections;
  loaded = true;
  await persist();
  return accounts;
}

export async function removeFederatedAccount(server: string) {
  await loadFederatedAccounts();
  accounts = accounts.filter(a => a.server !== server);
  for (const [id, acc] of calendarOrigin) if (acc.server === server) calendarOrigin.delete(id);
  await persist();
}

/** Disconnect a federated server on the home server, then locally. */
export async function disconnectFederatedServer(server: string) {
  await requireHome()(`/api/${apiVersion}/users/connections/musubi`, {
    body: JSON.stringify({ server }),
    headers: { "content-type": "application/json" },
    method: "DELETE",
  });
  await removeFederatedAccount(server);
}

/** The remote connection owning this calendar, or null for home calendars. */
export function remoteForCalendar(calendarID: string | null | undefined): FederatedAccount | null {
  if (!calendarID) return null;
  return calendarOrigin.get(calendarID) ?? null;
}

/**
 * JSON request against a federated server, routed through the home gateway.
 * Same call shape as before, so every caller in services/api.ts is unchanged —
 * only the credential handling moved to the server.
 */
export async function fedFetch<T>(acc: FederatedAccount, path: string, init?: RequestInit): Promise<T> {
  return requireHome()<T>(`/api/${apiVersion}/federation/s/${acc.id}${path}`, init);
}

const reviveEvent = (e: any): Event => ({ ...e, start: new Date(e.start), end: new Date(e.end) });
const revivePreviewEvent = (e: any) => ({ ...e, start: new Date(e.start), end: new Date(e.end) });

/**
 * Public invite preview on a remote server. Fetched through the home server so
 * one code path serves every platform (and so a browser build works too).
 */
export async function fetchRemoteCalendarPreview(server: string, inviteToken: string) {
  const query = new URLSearchParams({ server, token: inviteToken });
  const data = await requireHome()<CalendarInvitePreview>(
    `/api/${apiVersion}/federation/preview?${query.toString()}`,
  );
  return { ...data, events: (data.events ?? []).map(revivePreviewEvent) };
}

/**
 * Accept a cross-server invite. The handshake runs on the home server: it
 * verifies against the origin, stores the connection and keeps the member token
 * (ADR-005), so nothing secret reaches this device.
 */
export async function acceptRemoteInvite(server: string, inviteToken: string) {
  const { calendar } = await requireHome()<{ calendar: Calendar | null }>(
    `/api/${apiVersion}/federation/connect`,
    {
      body: JSON.stringify({ server, token: inviteToken }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  const [account] = (await refreshFederatedAccounts()).filter(a => a.server === server);
  return { account, calendar };
}

/**
 * Pull calendars + events from every federated server (v1: full fetch, no
 * delta). A server that's down keeps its previously cached calendars via
 * `fallbackCalendars` so a temporary outage doesn't wipe local copies.
 */
export async function syncFederatedAccounts(fallbackCalendars: Calendar[]) {
  // The home server owns the registry; fall back to the cache when offline.
  try {
    await refreshFederatedAccounts();
  } catch {
    await loadFederatedAccounts();
  }
  const calendars: Calendar[] = [];
  const events: Event[] = [];
  const syncedServers = new Set<string>();

  for (const acc of [...accounts]) {
    try {
      const cals = await fedFetch<Calendar[]>(acc, "/api/v1/calendars");
      const tagged = cals.map(c => ({
        ...c,
        provider: "musubi",       // groups them in the calendar list UI
        serverUrl: acc.server,    // lets the app show + route by origin
        accountId: acc.id,        // per-server grouping in the calendar list
        accountLabel: acc.label,
        syncStatus: "active" as const,
      }));
      const { events: evs } = await fedFetch<{ events: any[] }>(acc, "/api/v1/events");
      for (const c of tagged) calendarOrigin.set(c.id, acc);
      calendars.push(...tagged);
      events.push(...evs.map(reviveEvent));
      syncedServers.add(acc.server);
    } catch (e) {
      console.warn(`Federated sync failed for ${acc.label}:`, e);
      // Keep the last known calendars so the reconcile pass doesn't drop them,
      // but mark them when the ORIGIN rejected us: a dead or revoked member
      // token can only be replaced by accepting a new invite, so that needs
      // saying. A merely unreachable server is transient — showing "expired"
      // for a dropped connection would send the user chasing a non-problem.
      // The gateway relays the origin's status and turns unreachable into 502.
      const rejected = /^(401|403):/.test(String((e as Error)?.message ?? ""));
      const cached = fallbackCalendars
        .filter(c => c.provider === "musubi" && c.serverUrl === acc.server)
        .map(c => rejected
          ? { ...c, syncStatus: "reconnect_required" as const, syncErrorCode: "federation_unauthorized" }
          : c);
      for (const c of cached) calendarOrigin.set(c.id, acc);
      calendars.push(...cached);
    }
  }
  return { calendars, events, syncedServers };
}
