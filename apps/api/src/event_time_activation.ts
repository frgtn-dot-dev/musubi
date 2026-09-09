import { compareVersions, isCompatibleVersion, MIN_CLIENT_VERSION, MIN_PEER_VERSION, PRODUCT_VERSION } from "@musubi/types";

/** Released 0.1.8 can discard time metadata when copying to a new identity.
 * Changing the feature flag alone cannot make that client safe. */
export function assertEventTimeActivation(
  environment: string,
  enabled: boolean | { eventTimeEditsEnabled: boolean; providerOrganizerEditsEnabled: boolean; caldavOrganizerEditsEnabled: boolean },
  versions = { product: PRODUCT_VERSION, client: MIN_CLIENT_VERSION, peer: MIN_PEER_VERSION },
) {
  const active = typeof enabled === "boolean" ? enabled : enabled.eventTimeEditsEnabled || enabled.providerOrganizerEditsEnabled || enabled.caldavOrganizerEditsEnabled;
  if (!active || environment !== "prod") return;
  if (!isCompatibleVersion(versions.client, "0.1.8") ||
      !isCompatibleVersion(versions.peer, "0.1.8") ||
      compareVersions(versions.client, "0.1.8") <= 0 ||
      compareVersions(versions.peer, "0.1.8") <= 0 ||
      !isCompatibleVersion(versions.product, versions.client) ||
      !isCompatibleVersion(versions.product, versions.peer)) {
    throw new Error("Known-time editing or organizer activation requires a compatible release newer than 0.1.8 and enforced client/peer minimums newer than 0.1.8. Keep the flag disabled until the coordinated release is ready.");
  }
}
