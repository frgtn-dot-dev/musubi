import { getMusubiAccounts } from "@musubi/db";
import { logger } from "@musubi/config";
import { decryptSecret } from "./sync/crypto";
import { assertPublicOrigin, canonicalHttpOrigin } from "./federation_origin";

// Federated realtime fan-in (ADR-005 phase 2).
//
// Clients hold ONE stream — to their own server. When a user is connected, this
// server subscribes to each of their federated servers and re-emits what arrives
// into its own hub as `federated_sync`. So live updates from another Musubi
// server reach every client without any of them holding a member token, and
// without one SSE connection per server per tab.

const RECONNECT_DELAY_MS = 5_000;

type Subscription = { abort: AbortController };

const subscriptions = new Map<string, Subscription[]>();

/**
 * Split a buffer into complete SSE frames.
 *
 * Returns the parsed `data:` payloads plus whatever partial frame is left over,
 * because a chunk boundary can land mid-frame.
 */
export function parseSseFrames(buffer: string): {
  payloads: string[];
  rest: string;
} {
  const parts = buffer.split("\n\n");
  // The final piece is either an incomplete frame or "".
  const rest = parts.pop() ?? "";
  const payloads: string[] = [];

  for (const frame of parts) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    // Comment-only frames (keepalives) carry no data.
    if (data) payloads.push(data);
  }

  return { payloads, rest };
}

async function streamOne(
  userID: string,
  connection: { encryptedToken: string; id: string; server: string },
  abort: AbortController,
  emit: (userID: string, type: string, payload: Record<string, unknown>) => void,
) {
  const origin = canonicalHttpOrigin(connection.server);
  if (!origin) return;

  while (!abort.signal.aborted) {
    try {
      await assertPublicOrigin(origin);
      const response = await fetch(`${origin}/api/stream`, {
        headers: {
          accept: "text/event-stream",
          authorization: `Bearer ${decryptSecret(connection.encryptedToken)}`,
        },
        redirect: "manual",
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`stream responded ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!abort.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { payloads, rest } = parseSseFrames(buffer);
        buffer = rest;

        for (const payload of payloads) {
          let parsed: { type?: string };
          try {
            parsed = JSON.parse(payload) as { type?: string };
          } catch {
            continue;
          }
          // The upstream payload isn't forwarded: a client can't merge another
          // server's rows anyway, it just refetches that server's snapshot.
          emit(userID, "federated_sync", {
            server: origin,
            upstreamType: parsed.type ?? "unknown",
          });
        }
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      logger.warn("federation.stream.dropped", {
        connectionId: connection.id,
        error: error instanceof Error ? error.message : String(error),
        server: origin,
      });
    }

    if (abort.signal.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
  }
}

/**
 * Subscribe to every federated server this user is connected to. Safe to call
 * repeatedly: it no-ops while subscriptions are already running.
 */
export async function startFederatedStreams(
  userID: string,
  emit: (userID: string, type: string, payload: Record<string, unknown>) => void,
) {
  if (subscriptions.has(userID)) return;
  // Claim the slot before awaiting so two near-simultaneous connections from the
  // same user can't both start a set of streams.
  subscriptions.set(userID, []);

  let connections: Awaited<ReturnType<typeof getMusubiAccounts>>;
  try {
    connections = await getMusubiAccounts(userID);
  } catch (error) {
    subscriptions.delete(userID);
    logger.warn("federation.stream.lookup_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const running = subscriptions.get(userID);
  // The user disconnected while we were loading.
  if (!running) return;

  for (const connection of connections) {
    const abort = new AbortController();
    running.push({ abort });
    void streamOne(userID, connection, abort, emit);
  }
}

/** Drop every upstream stream for a user once their last client disconnects. */
export function stopFederatedStreams(userID: string) {
  for (const subscription of subscriptions.get(userID) ?? []) {
    subscription.abort.abort();
  }
  subscriptions.delete(userID);
}

export function federatedStreamStats() {
  let upstream = 0;
  for (const list of subscriptions.values()) upstream += list.length;
  return { upstream, users: subscriptions.size };
}
