# Musubi Web

TanStack Start web client for the Musubi monorepo. Express remains the owner of
`/api/*`; this app owns the authenticated web shell and future public web
surfaces.

## Local commands

```bash
pnpm --filter @musubi/web dev
pnpm --filter @musubi/web typecheck
pnpm --filter @musubi/web test
pnpm --filter @musubi/web lint
pnpm --filter @musubi/web build
pnpm --filter @musubi/web start
```

The browser uses relative `/api/*` URLs. Vite proxies those requests to the
local Express API on port 7531; production keeps the same paths on one origin.

## Current boundary

The authenticated Month route reads the canonical Express calendars, events and
settings contracts through TanStack Query and validates them with
`@musubi/types`. The Month is intentionally read-only until the following
mutation slice; fixture data remains test-only UI material.
