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

The browser uses relative `/api/*` URLs. Server-side API calls will use
`API_INTERNAL_URL` once the authenticated data slice is connected.

## Current boundary

The first prototype uses local fixtures to stabilize the shell, Month view,
quick interactions and Page draft behavior before wiring the canonical Express
contracts. Fixture data must not become a second domain model; production API
resources belong in TanStack Query and are validated with `@musubi/types`.
