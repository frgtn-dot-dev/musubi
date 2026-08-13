import { lookup } from "node:dns/promises";
import { isIPv4 } from "node:net";
import ipaddr from "ipaddr.js";
import { config } from "@musubi/config";

export function canonicalHttpOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

// ── SSRF guard for the federation gateway ────────────────────────────────────
// The gateway makes this API fetch an origin the user supplied (once, when they
// saved the connection). Without this, a signed-in user could aim their home
// server at internal services or the cloud metadata endpoint.

// [network, prefix length]
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this host"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — cloud metadata lives at 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function isBlockedAddress(address: string): boolean {
  const ip = address.trim().toLowerCase();

  if (isIPv4(ip)) {
    const value = v4ToInt(ip);
    if (value === null) return true; // unparsable → refuse
    return BLOCKED_V4.some(([network, bits]) => {
      const base = v4ToInt(network)!;
      // >>> 0 keeps the mask unsigned.
      const mask = (~0 << (32 - bits)) >>> 0;
      return (value & mask) === (base & mask);
    });
  }

  // Only IPv6 literals below — a hostname (no colon) is judged by DNS instead,
  // so e.g. "fe80.example.com" isn't mistaken for a link-local address.
  if (!ip.includes(":")) return false;

  try {
    const parsed = ipaddr.parse(ip);
    if (parsed.kind() !== "ipv6") return true;
    const ipv6 = parsed as ipaddr.IPv6;
    if (ipv6.isIPv4MappedAddress()) {
      return isBlockedAddress(ipv6.toIPv4Address().toString());
    }
    return ipv6.range() !== "unicast";
  } catch {
    return true;
  }
}

/**
 * Resolve `origin` and refuse it when any address is internal.
 *
 * Called when a connection is saved AND immediately before every gateway
 * request, so a record that later points inward stops working. A DNS rebinding
 * window between this check and the connect remains: we validate the resolved
 * addresses but still connect by hostname (pinning the IP would break TLS SNI).
 * Accepted for v1 — reaching this code already requires an authenticated user
 * probing their own home server's network, and `FEDERATION_ALLOW_PRIVATE_HOSTS`
 * exists for deployments where internal targets are legitimate (LAN self-host).
 */
export async function assertPublicOrigin(
  origin: string,
  // Overridable so the guard itself is testable — outside prod the flag defaults
  // to true, which would short-circuit every check.
  { allowPrivate = config.security.federationAllowPrivateHosts } = {},
): Promise<void> {
  if (allowPrivate) return;

  let host: string;
  try {
    host = new URL(origin).hostname.replace(/^\[|\]$/g, "");
  } catch {
    throw new Error("Invalid HTTP origin.");
  }

  // A literal internal address needs no lookup.
  if (isBlockedAddress(host)) {
    throw new Error(`Refusing to reach the internal address ${host}.`);
  }

  let addresses: string[];
  try {
    addresses = (await lookup(host, { all: true })).map(
      (entry) => entry.address,
    );
  } catch {
    throw new Error(`Could not resolve ${host}.`);
  }

  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new Error(`Refusing to reach the internal address behind ${host}.`);
  }
}
