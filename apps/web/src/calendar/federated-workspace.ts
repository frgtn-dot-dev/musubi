import type { Calendar, Event } from "@musubi/types";
import { useQuery } from "@tanstack/react-query";
import type { FederationConnection } from "~/api/contracts";
import { ApiError } from "~/api/http";
import {
  getFederatedCalendars,
  getFederatedEvents,
  getFederationConnections,
} from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";

// Calendars living on OTHER Musubi servers. Everything goes through the home
// gateway (ADR-005), so the browser never holds a cross-server credential and
// stays same-origin.
//
// The fan-out is per connection so one unreachable server degrades to a status
// row instead of failing the whole workspace — the home calendar must never go
// dark because someone else's server is down.

/**
 * `unauthorized` and `unreachable` need different words and different actions:
 * a dead or revoked member token can only be replaced by accepting a new invite,
 * while an unreachable server just needs another try.
 */
export type FederatedServerState =
  | "active"
  | "unauthorized"
  | "unreachable";

export type FederatedServerStatus = {
  connectionId: string;
  label: string;
  server: string;
  state: FederatedServerState;
};

function failureState(error: unknown): FederatedServerState {
  // The gateway relays the origin's status, and turns an unreachable origin into
  // 502 — so 401/403 really did come from the origin rejecting our credential.
  return error instanceof ApiError &&
    (error.status === 401 || error.status === 403)
    ? "unauthorized"
    : "unreachable";
}

export type FederatedWorkspace = {
  calendars: Calendar[];
  events: Event[];
  servers: FederatedServerStatus[];
};

// Tag remote calendars so the generic provider UI (per-server grouping,
// disconnect, badges) renders them without federation-specific branches.
function tagCalendar(
  calendar: Calendar,
  connection: FederationConnection,
): Calendar {
  return {
    ...calendar,
    accountId: connection.id,
    accountLabel: connection.label,
    provider: "musubi",
    serverUrl: connection.server,
  };
}

async function loadFederatedWorkspace(
  signal?: AbortSignal,
): Promise<FederatedWorkspace> {
  const connections = await getFederationConnections(signal);
  if (connections.length === 0) {
    return { calendars: [], events: [], servers: [] };
  }

  const perServer = await Promise.all(
    connections.map(async (connection) => {
      try {
        // One server's calendars and events can load together; a failure of
        // either marks just this server unreachable.
        const [calendars, events] = await Promise.all([
          getFederatedCalendars(connection.id, signal),
          getFederatedEvents(connection.id, signal),
        ]);
        return {
          calendars: calendars.map((calendar) => tagCalendar(calendar, connection)),
          events: events.events.filter((event) => !event.isCanceled),
          status: {
            connectionId: connection.id,
            label: connection.label,
            server: connection.server,
            state: "active" as FederatedServerState,
          },
        };
      } catch (error) {
        return {
          calendars: [],
          events: [],
          status: {
            connectionId: connection.id,
            label: connection.label,
            server: connection.server,
            state: failureState(error),
          },
        };
      }
    }),
  );

  return {
    calendars: perServer.flatMap((entry) => entry.calendars),
    events: perServer.flatMap((entry) => entry.events),
    servers: perServer.map((entry) => entry.status),
  };
}

export function useFederatedWorkspace(userId: string) {
  return useQuery({
    enabled: typeof window !== "undefined" && userId !== "anonymous",
    queryFn: ({ signal }) => loadFederatedWorkspace(signal),
    queryKey: queryKeys.federated(getServerOrigin(), userId),
  });
}
