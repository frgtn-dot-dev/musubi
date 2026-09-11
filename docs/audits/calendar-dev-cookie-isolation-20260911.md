# Development browser cookie isolation — 2026-09-11

## Observed failure

Live calendar QA on the local Musubi web/API repeatedly returned to sign-in.
Read-only database checks showed that the browser's sessions still existed and
had seven-day expiry dates. Installed Better Auth configuration also used a
seven-day session cookie; its optional five-minute session-data cache was not
enabled. The observed intervals do not establish a short session timeout.

A temporary metadata-only API observer recorded the session cookie present on
an accepted request at 11:39:54 UTC, then absent on the first 401 at 11:41:16.
The absence preceded Musubi's sign-out requests and cookie-clearing responses.
The observer recorded cookie-name presence, response status and session-presence
booleans, never cookie values, session IDs, tokens or response bodies.

The owner confirmed concurrent use of `auto-cv` on port 5174. Both applications
used Better Auth's default cookie prefix and root path. Cookies on the same
hostname are shared across ports, so another application's sign-in or sign-out
can replace or clear that cookie. This is a supported collision explanation,
but the exact browser action or application that removed it was not observed.

## Bounded change

`DEV_AUTH_COOKIE_PREFIX` optionally supplies Better Auth's `advanced.cookiePrefix`
through `config.security.devAuthCookiePrefix`. Unset or whitespace-only values
preserve the existing cookie names. A configured value is accepted only when
`ENVIRONMENT=dev`; test and production reject it. After trimming, a prefix must
contain 1–64 ASCII letters, digits, underscores or hyphens. Validation errors
do not echo the rejected value.

The setting and its restrictions are documented in `.env.example`. It is for
browser QA isolation only. Changing the prefix requires a new sign-in. Native
Expo clients expect the default prefix, so the override must remain unset for
native QA. No production default, cookie lifetime, security attribute, release
version or other application's configuration was changed.

The private QA environment opted into a distinct prefix, followed by an API
restart and normal Google OAuth sign-in. Between 11:48 and 11:58 UTC, the
observer recorded **62 accepted requests, zero 401 responses and zero sign-outs**.
All-day calendar browser acceptance continued after this observation window;
its operation and provider-readback results belong in the separate acceptance
report. This window supports the isolation remedy, not indefinite stability.

## Verification and limits

- Config tests cover default/blank values in every environment, valid prefixes,
  the 64-character limit, invalid characters, safe errors and non-dev refusal.
- Tests against the installed Better Auth cookie factory verify that an unset
  override exactly preserves defaults, the session lifetime remains seven days,
  and custom prefixes change cookie names while retaining attributes for both
  HTTP and HTTPS configuration.
- All config/auth test entry points passed, including logger and Apple secret
  checks. They were rerun with `ENVIRONMENT=test DEV_AUTH_COOKIE_PREFIX=' '` and
  `node --import tsx` to prevent dotenv from importing the private QA prefix and
  to avoid the sandbox's restriction on the tsx CLI's IPC socket.
- API TypeScript checking passed during implementation:
  `pnpm exec tsc -p apps/api/tsconfig.json --noEmit --skipLibCheck`.

The earlier SessionGate fix also prevents a resolved transient session-check
error from triggering sign-out. Its unit and mocked browser regressions passed,
including a negative control against the old decision. That is a separate
weakness: it does not explain an already absent request cookie.

This work does not claim native/Expo acceptance, a production migration,
identification of the exact cookie-clearing actor, or complete all-day calendar
acceptance. The observer was temporary local QA instrumentation, not a tracked
production logging change.
