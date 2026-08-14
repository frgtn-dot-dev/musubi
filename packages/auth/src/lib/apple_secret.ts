import { createPrivateKey, sign } from "node:crypto";

/**
 * Apple's "client secret" is not a secret you paste — it is a short-lived ES256
 * JWT you sign with the .p8 key from the developer portal, and Apple refuses one
 * older than six months. Storing a pre-signed token in an env var therefore ships
 * a time bomb: sign-in works for months and then stops on an ordinary Tuesday,
 * far from any deploy that could explain it. So the server signs its own, fresh
 * per exchange.
 *
 * This is only for the browser flow. The phone sends an identity token that
 * Better Auth verifies against the app's bundle id — no secret involved.
 */
export type AppleWebCredentials = {
  /** Key ID of the .p8 key (portal → Keys). */
  keyId: string;
  /** Contents of the .p8 file. Literal "\n" sequences are accepted, so it fits on one env line. */
  privateKey: string;
  /** The Services ID — a separate identifier from the app's bundle id. */
  servicesId: string;
  teamId: string;
};

/** Ten minutes: long enough for one code exchange, short enough to never be stale. */
const LIFETIME_SECONDS = 10 * 60;

export function appleWebConfigured(credentials: Partial<AppleWebCredentials>) {
  return Boolean(
    credentials.keyId &&
      credentials.privateKey &&
      credentials.servicesId &&
      credentials.teamId,
  );
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * A .p8 as it survives an env file.
 *
 * Docker env files and Dokploy's editor are line-based, so the PEM arrives with
 * its newlines escaped. Both forms are accepted rather than making the operator
 * discover which one this wanted.
 */
function readPrivateKey(privateKey: string) {
  const pem = privateKey.includes("\\n")
    ? privateKey.replace(/\\n/g, "\n")
    : privateKey;
  return createPrivateKey(pem.trim());
}

export function appleClientSecret(
  credentials: AppleWebCredentials,
  now = () => Date.now(),
) {
  const issuedAt = Math.floor(now() / 1000);
  const header = base64Url(
    JSON.stringify({ alg: "ES256", kid: credentials.keyId, typ: "JWT" }),
  );
  const payload = base64Url(
    JSON.stringify({
      aud: "https://appleid.apple.com",
      exp: issuedAt + LIFETIME_SECONDS,
      iat: issuedAt,
      iss: credentials.teamId,
      sub: credentials.servicesId,
    }),
  );
  // `ieee-p1363` is the raw r|s pair JWS wants; the default DER encoding would
  // produce a signature Apple rejects without saying why.
  const signature = sign(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    { dsaEncoding: "ieee-p1363", key: readPrivateKey(credentials.privateKey) },
  );

  return `${header}.${payload}.${base64Url(signature)}`;
}
