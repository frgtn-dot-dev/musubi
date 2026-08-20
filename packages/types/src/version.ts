/**
 * The product version, mirrored from the root manifest.
 *
 * Not imported from `package.json`: the API ships as a `pnpm deploy` closure
 * with no repository root above it, so there is nothing to import at runtime.
 * `scripts/verify-release.mjs` asserts this string matches instead — the drift
 * it now prevents is real, this file's predecessor sat two releases behind the
 * product it claimed to be.
 */
export const PRODUCT_VERSION = "0.1.5";

/**
 * The oldest phone build this server will talk to.
 *
 * Raising it locks every older install out until its owner updates from the
 * store, so it moves only when a release genuinely cannot serve them — see
 * `docs/releasing.md`.
 */
export const MIN_CLIENT_VERSION = "0.1.3";
