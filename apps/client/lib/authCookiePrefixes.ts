/** Keep production auth unchanged while allowing an explicitly isolated QA API.
 * Accept the default too: a dev client can still switch to a normal server. */
export function authCookiePrefixes(isDev: boolean, configured?: string): string[] {
  if (!isDev || !configured?.trim()) return ["better-auth"];
  const prefix = configured.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(prefix)) {
    throw new Error("EXPO_PUBLIC_DEV_AUTH_COOKIE_PREFIX must contain 1–64 letters, digits, underscores, or hyphens.");
  }
  return [...new Set(["better-auth", prefix])];
}
