import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import {
  appleClientSecret,
  appleWebConfigured,
  type AppleWebCredentials,
} from "./apple_secret";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
});

const credentials: AppleWebCredentials = {
  keyId: "ABC1234DEF",
  privateKey,
  servicesId: "pro.musubi.web",
  teamId: "79683753W3",
};

const decode = (part: string) =>
  JSON.parse(Buffer.from(part, "base64url").toString());

// A token Apple accepts, or sign-in fails with an error that says nothing.
{
  const at = Date.UTC(2026, 7, 2, 12, 0, 0);
  const [header, payload, signature] = appleClientSecret(
    credentials,
    () => at,
  ).split(".");

  assert.deepEqual(decode(header!), {
    alg: "ES256",
    kid: "ABC1234DEF",
    typ: "JWT",
  });
  assert.deepEqual(decode(payload!), {
    aud: "https://appleid.apple.com",
    exp: at / 1000 + 600,
    iat: at / 1000,
    // Apple reads the team from `iss` and the Services ID — not the bundle id —
    // from `sub`. Swapping them is the classic invalid_client.
    iss: "79683753W3",
    sub: "pro.musubi.web",
  });

  // Raw r|s, 64 bytes for P-256. DER encoding is the other classic failure, and
  // it is one Apple reports as a generic error.
  const raw = Buffer.from(signature!, "base64url");
  assert.equal(raw.length, 64);
  assert.ok(
    verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { dsaEncoding: "ieee-p1363", key: publicKey },
      raw,
    ),
    "signature does not verify against the key that made it",
  );
}

// Every call is fresh: a process that has been up for months must not be handing
// out a token signed at boot.
{
  const early = appleClientSecret(credentials, () => 1_000_000_000_000);
  const later = appleClientSecret(credentials, () => 1_000_000_600_000);
  assert.notEqual(early, later);
  assert.equal(decode(later.split(".")[1]!).iat - decode(early.split(".")[1]!).iat, 600);
}

// A .p8 pasted into a one-line env file arrives with its newlines escaped. It has
// to parse into the same key — compared by verifying, not by string equality:
// ECDSA is randomised, so signing the same bytes twice never gives the same token.
{
  const escaped = { ...credentials, privateKey: privateKey.replace(/\n/g, "\\n") };
  const [header, payload, signature] = appleClientSecret(escaped, () => 0).split(".");

  assert.deepEqual(
    decode(payload!),
    decode(appleClientSecret(credentials, () => 0).split(".")[1]!),
  );
  assert.ok(
    verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { dsaEncoding: "ieee-p1363", key: publicKey },
      Buffer.from(signature!, "base64url"),
    ),
    "an escaped .p8 produced a signature the real key cannot verify",
  );
}

// Half-configured is not configured: the web button must stay hidden rather than
// open a page that cannot come back.
assert.equal(appleWebConfigured(credentials), true);
assert.equal(appleWebConfigured({ ...credentials, keyId: "" }), false);
assert.equal(appleWebConfigured({ ...credentials, privateKey: "" }), false);
assert.equal(appleWebConfigured({ ...credentials, servicesId: "" }), false);
assert.equal(appleWebConfigured({ ...credentials, teamId: "" }), false);

console.log("apple client secret self-check: OK");
