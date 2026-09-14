import { isCompatibleVersion, MIN_CLIENT_VERSION, MIN_PEER_VERSION, PRODUCT_VERSION } from "@musubi/types";

/** 0.2.0 is the first coordinated release with time-preserving clients and peers.
 * Older writers can discard time metadata when copying to a new identity. */
export function assertEventTimeActivation(
  environment: string,
  enabled: boolean | { eventTimeEditsEnabled: boolean; providerOrganizerEditsEnabled: boolean; caldavOrganizerEditsEnabled: boolean },
  versions = { product: PRODUCT_VERSION, client: MIN_CLIENT_VERSION, peer: MIN_PEER_VERSION },
) {
  const active = typeof enabled === "boolean" ? enabled : enabled.eventTimeEditsEnabled || enabled.providerOrganizerEditsEnabled || enabled.caldavOrganizerEditsEnabled;
  if (!active || environment !== "prod") return;
  if (!isCompatibleVersion(versions.client, "0.2.0") ||
      !isCompatibleVersion(versions.peer, "0.2.0") ||
      !isCompatibleVersion(versions.product, versions.client) ||
      !isCompatibleVersion(versions.product, versions.peer)) {
    throw new Error("Known-time editing or organizer activation requires a compatible release and enforced client/peer minimums of at least 0.2.0. Keep the flag disabled until the coordinated release is ready.");
  }
}
