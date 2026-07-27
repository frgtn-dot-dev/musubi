import assert from "node:assert/strict";
import {
  assertPublicOrigin,
  canonicalHttpOrigin,
  isBlockedAddress,
} from "./federation_origin";
import { gatewayTarget } from "./handlers/federation_proxy";

// SSRF + path-escape guards for the federation gateway (ADR-005).

// ── Internal address ranges are refused ──────────────────────────────────────
for (const blocked of [
  "127.0.0.1",
  "127.1.2.3",
  "10.0.0.7",
  "172.16.0.1",
  "172.31.255.254",
  "192.168.1.10",
  "169.254.169.254", // cloud metadata
  "100.64.0.1",      // CGNAT
  "0.0.0.0",
  "224.0.0.1",
  "240.0.0.1",
  "::1",
  "::",
  "fe80::1",
  "fc00::1",
  "fd12:3456::1",
  "::ffff:127.0.0.1", // v4-mapped loopback
  "::ffff:10.1.2.3",
]) {
  assert.equal(isBlockedAddress(blocked), true, `${blocked} must be refused`);
}

for (const allowed of [
  "1.1.1.1",
  "8.8.8.8",
  "172.32.0.1",   // just outside 172.16/12
  "192.169.0.1",  // just outside 192.168/16
  "100.128.0.1",  // just outside 100.64/10
  "2606:4700::1111",
]) {
  assert.equal(isBlockedAddress(allowed), false, `${allowed} must be allowed`);
}

// A hostname is judged by DNS, not by its spelling.
assert.equal(isBlockedAddress("fe80.example.com"), false);
assert.equal(isBlockedAddress("example.com"), false);

// ── Origin canonicalization ──────────────────────────────────────────────────
assert.equal(canonicalHttpOrigin("https://b.example"), "https://b.example");
for (const rejected of [
  "https://user:pw@b.example",     // credentials
  "file:///etc/passwd",            // non-http scheme
  "gopher://b.example",
  "https://b.example/some/path",   // path
  "https://b.example/?a=1",        // query
  "not a url",
]) {
  assert.equal(canonicalHttpOrigin(rejected), null, `${rejected} must be refused`);
}

// ── Literal internal targets are refused without a lookup ────────────────────
async function originGuardChecks() {
  await assert.rejects(
    () => assertPublicOrigin("http://169.254.169.254", { allowPrivate: false }),
    /internal address/,
  );
  await assert.rejects(
    () => assertPublicOrigin("http://127.0.0.1:7532", { allowPrivate: false }),
    /internal address/,
  );
  await assert.rejects(
    () => assertPublicOrigin("http://[::1]:7532", { allowPrivate: false }),
    /internal address/,
  );
  // Unresolvable host fails closed.
  await assert.rejects(
    () => assertPublicOrigin("https://no-such-host.invalid", { allowPrivate: false }),
    /Could not resolve/,
  );
  // The opt-in escape hatch (LAN self-hosting) skips the guard.
  await assertPublicOrigin("http://127.0.0.1:7532", { allowPrivate: true });
}

// ── Path escapes cannot leave the connected origin ───────────────────────────
const origin = "https://b.example";
assert.equal(
  gatewayTarget(origin, "api/v1/calendars").href,
  "https://b.example/api/v1/calendars",
);
assert.equal(
  gatewayTarget(origin, "api/v1/events", "?since=2026-07-01").href,
  "https://b.example/api/v1/events?since=2026-07-01",
);

for (const escape of [
  "/api/v1/../../etc/passwd",       // traversal normalizes out of /api/v1
  "api/v1/../../../secret",
  "api/auth/session",               // outside the allowlisted prefix
  "healthz",
]) {
  assert.throws(
    () => gatewayTarget(origin, escape),
    /gateway/,
    `${escape} must be refused`,
  );
}

// A protocol-relative or absolute path must not change host.
for (const hostSwap of ["//evil.example/api/v1/x", "https://evil.example/api/v1/x"]) {
  assert.throws(() => gatewayTarget(origin, hostSwap), /gateway/, `${hostSwap} must be refused`);
}

void originGuardChecks().then(() => {
  console.log("federation gateway guard self-check: OK");
});
