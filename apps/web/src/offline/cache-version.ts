import musubiPackage from "../../../../package.json";

/**
 * Bump when the shape of anything cached changes in a way an older build would
 * misread — a contract field, a query key, or what the persister stores around
 * the data. A bump throws every existing snapshot away, which is the point.
 */
export const CACHE_SCHEMA_VERSION = 1;

/**
 * The buster: cache schema plus the app's major version. A major release may
 * change how data is read even when the schema number stands still, and a
 * snapshot written by a different build is not worth guessing about.
 */
export const CACHE_BUSTER = `${CACHE_SCHEMA_VERSION}.${
  musubiPackage.version.split(".")[0] ?? "0"
}`;

/** A week. Long enough to be useful on a trip, short enough not to feel haunted. */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * How many event windows survive. Each date step makes a new cache entry holding
 * a full payload, so without a cap a week of browsing would grow the snapshot
 * without bound.
 */
export const CACHE_EVENT_RANGE_LIMIT = 8;

/**
 * A short, stable fingerprint of the server origin — a key, not a secret, so a
 * non-cryptographic hash is the right size of tool. Keeps the namespace readable
 * in devtools instead of embedding a whole URL.
 */
export function hashOrigin(origin: string) {
  let hash = 2_166_136_261;

  for (let index = 0; index < origin.length; index += 1) {
    hash ^= origin.charCodeAt(index);
    // FNV-1a: multiply by the prime through shifts, so it stays in 32 bits.
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0).toString(36);
}

/**
 * `musubi:<serverOriginHash>:<userId>:<cacheVersion>` — one namespace per
 * account per server, so two accounts on one machine cannot read each other's
 * calendar and a version bump cannot resurrect an old shape.
 */
export function cacheNamespace(origin: string, userId: string) {
  return `musubi:${hashOrigin(origin)}:${userId}:${CACHE_BUSTER}`;
}
