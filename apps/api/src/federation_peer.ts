import { logger } from "@musubi/config";
import { compareVersions, MIN_PEER_VERSION } from "@musubi/types";

const PEER_TIMEOUT_MS = 8_000;

/**
 * What another Musubi server says it is.
 *
 * `version` is null when the server answered but named no version, which means
 * something older than the field or something that is not Musubi at all. That
 * is not enough to refuse on — the read rule says a missing field is tolerated,
 * not fatal — but it is worth writing down.
 */
export type Peer = { version: string | null };

export async function readPeer(origin: string): Promise<Peer | null> {
  try {
    const response = await fetch(`${origin}/api/v1/server`, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(PEER_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return { version: typeof body.version === "string" ? body.version : null };
  } catch {
    // Unreachable, slow, or not JSON. The caller is about to try the real
    // request anyway and will fail with a better message than this could give.
    return null;
  }
}

/**
 * Why this server will not federate with that one, or null when it will.
 *
 * Deliberately permissive about everything except an outright old version: a
 * peer that cannot be read, or that names no version, is allowed through. The
 * handshake that follows is the real test, and refusing on silence would turn
 * every unfamiliar server into a dead end.
 */
export async function peerTooOld(origin: string): Promise<string | null> {
  const peer = await readPeer(origin);

  if (!peer) return null;
  if (!peer.version) {
    logger.warn("federation.peer.unversioned", { server: origin });
    return null;
  }
  if (compareVersions(peer.version, MIN_PEER_VERSION) >= 0) return null;

  logger.warn("federation.peer.too_old", {
    minimum: MIN_PEER_VERSION,
    server: origin,
    version: peer.version,
  });
  return (
    `That server runs Musubi ${peer.version}. Connecting needs ` +
    `${MIN_PEER_VERSION} or newer — its owner has to update it first.`
  );
}
