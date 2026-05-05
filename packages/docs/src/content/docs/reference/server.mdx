---
title: Server
description: Reference for the Musubi backend packages.
---

import { Aside } from '@astrojs/starlight/components';

The Musubi backend is split into shared packages inside `packages/` rather than a single server app. Auth, database schema, and config are each their own package, consumed by any server runtime you wire up.

## Package structure

```
packages/
├── auth/        # Better Auth server setup
├── db/          # Drizzle ORM schema + queries
├── config/      # Shared environment config
└── types/       # Shared TypeScript types
```

## `packages/auth`

Configures [Better Auth](https://better-auth.com) for the server. Exports an `auth` instance that handles:

- Email / password sign-in and sign-up
- Session management via bearer tokens (the `bearer` plugin)
- Trusted origins for the Expo client (dev and prod)
- Middleware helpers

**Entry point:** `packages/auth/src/index.ts`

## `packages/db`

Database access via [Drizzle ORM](https://orm.drizzle.team).

| File | Purpose |
|---|---|
| `src/schema.ts` | Table definitions (users, calendars, events, invites…) |
| `src/queries/` | Typed query helpers per domain |
| `src/index.ts` | Exports `db` client + all queries |
| `drizzle/` | Migration files |

### Running migrations

```sh
pnpm --filter db migrate
```

<Aside type="note">
  Musubi uses a SQL database (see `packages/config` for the `DATABASE_URL` key). Make sure the database is running and the URL is set before running migrations.
</Aside>

## `packages/config`

Shared environment variable parsing. Validates required keys at startup and exports typed config objects for other packages.

## `packages/types`

Shared TypeScript types used across client and server. Importing from here instead of redeclaring types prevents drift between the two sides.

## Core data model

```
User
 └── owns many Calendars
      └── has many Events
      └── has many Invites → other Users
```

A `Calendar` can have multiple **members** (users who joined via invite). Events are visible to all members of the calendar.

## Environment variables

| Key | Used by | Description |
|---|---|---|
| `DATABASE_URL` | `db` | Postgres connection string |
| `BETTER_AUTH_SECRET` | `auth` | Secret for signing sessions |
| `BETTER_AUTH_URL` | `auth` | Public URL of the auth server |

Copy `packages/config/.env.example` (or the root `.env.example`) to get started.

<Aside type="caution">
  The server packages are early MVP — some query helpers and endpoints are still being built out. Check `packages/db/src/queries/` for what's currently implemented.
</Aside>
