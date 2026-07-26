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

The authenticated Month, Day, Week and Agenda routes read the canonical Express
calendars, events, settings and pages contracts through TanStack Query and
validate them with `@musubi/types`. The sidebar lists the user's real Pages and
the workspace route resolves the `default` sentinel (and any stale id) to the
canonical default Page, keeping the current view and date. Event quick create,
edit and delete use the existing Express write endpoints, wait for confirmed
server responses and gate controls through the shared calendar permissions;
fixture data remains test-only. Page configuration is read-only for now — the
explicit editor (visibility, view, filters) lands with the Pages editor PR.
