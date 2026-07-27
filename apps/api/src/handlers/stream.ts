import { Request, Response } from "express";
import {
  federatedStreamStats,
  startFederatedStreams,
  stopFederatedStreams,
} from "../federation_stream";


// A Set per user — one user can stream from several devices at once, and a
// single-Response map would let a new connection silently evict the old one.
const clients = new Map<string, Set<Response>>();


export async function handlerStream(req: Request, res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const userID = req.user!.id;
  let connections = clients.get(userID);
  const first = !connections;
  if (!connections) {
    connections = new Set();
    clients.set(userID, connections);
  }
  connections.add(res);

  // Federated servers are subscribed once per user, not per client: their events
  // are re-emitted into this hub (ADR-005). External (shadow) members never own
  // federated connections, so they need no fan-in.
  if (first && !(req.user as { isExternal?: boolean }).isExternal) {
    void startFederatedStreams(userID, emitToUser);
  }

  req.on('close', () => {
    connections.delete(res);
    if (connections.size === 0) {
      clients.delete(userID);
      stopFederatedStreams(userID);
    }
  });
}

// Adapter: the fan-in emits to a single user, the hub takes a member list.
function emitToUser(
  userID: string,
  type: string,
  payload: Record<string, unknown>,
) {
  notifyCalendarMembers([userID], type, payload);
}

// Snapshot for /metrics: total open connections and how many distinct users
// hold them (a user can stream from several devices at once).
export function sseStats() {
  let connections = 0;
  for (const set of clients.values()) connections += set.size;
  const federated = federatedStreamStats();
  return {
    users: clients.size,
    connections,
    // Outbound streams this server holds to federated origins.
    federatedUpstream: federated.upstream,
  };
}

export function notifyCalendarMembers(memberIDs: string[], type: string, payload: Record<string, any>) {
  for (const memberID of memberIDs) {
    for (const res of clients.get(memberID) ?? []) {
      res.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
    }
  }
}
