import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

// With no explicit baseURL Better Auth uses the browser's current origin and
// its standard /api/auth base path. That keeps cookies first-party in both the
// Vite proxy and the eventual same-origin production deployment.
export const authClient = createAuthClient({
  // Passwordless sign-in by emailed code.
  plugins: [emailOTPClient()],
});

export const AUTH_EXPIRED_EVENT = "musubi:auth-expired";

export function notifyAuthExpired() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
}
