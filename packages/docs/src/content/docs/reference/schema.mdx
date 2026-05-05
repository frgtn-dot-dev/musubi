---
title: Database Schema
description: PostgreSQL schema for Musubi, managed with Drizzle ORM.
---

import { Aside } from '@astrojs/starlight/components';

All tables are defined in `packages/db/src/schema.ts` using Drizzle ORM against a PostgreSQL database.

## Auth tables

These four tables are owned and managed by [Better Auth](https://better-auth.com). Don't write to them directly — go through the `auth` instance.

### `user`

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | Better Auth–generated ID |
| `name` | `text` | Display name |
| `email` | `text` unique | |
| `email_verified` | `boolean` | Defaults to `false` |
| `image` | `text` | Optional avatar URL |
| `created_at` | `timestamp` | |
| `updated_at` | `timestamp` | Auto-updated |

### `session`

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | |
| `token` | `text` unique | Bearer token sent by client |
| `expires_at` | `timestamp` | |
| `ip_address` | `text` | Optional |
| `user_agent` | `text` | Optional |
| `user_id` | `text` FK → `user` | Cascade delete |

Index on `user_id`.

### `account`

Stores provider credentials. For email/password auth, `password` holds the hashed password.

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | |
| `account_id` | `text` | Provider-side account ID |
| `provider_id` | `text` | e.g. `"credential"` |
| `user_id` | `text` FK → `user` | Cascade delete |
| `password` | `text` | Hashed, email/password only |
| `access_token` | `text` | OAuth only |
| `refresh_token` | `text` | OAuth only |

Index on `user_id`.

### `verification`

Short-lived tokens for email verification and password reset flows.

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | |
| `identifier` | `text` | Usually the user's email |
| `value` | `text` | The token value |
| `expires_at` | `timestamp` | |

Index on `identifier`.

---

## App tables

### `calendars`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Random |
| `name` | `text` | Calendar display name |
| `color` | `text` | Hex color for UI |
| `creator_id` | `text` FK → `user` | Cascade delete |
| `created_at` | `timestamp` | |
| `updated_at` | `timestamp` | Auto-updated |

### `events`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Random |
| `name` | `text` | Event title (column alias `title` in code) |
| `color` | `text` | Hex color for UI |
| `start_at` | `timestamp` | Event start |
| `end_at` | `timestamp` | Event end |
| `creator_id` | `text` FK → `user` | Cascade delete |
| `created_at` | `timestamp` | |
| `updated_at` | `timestamp` | Auto-updated |

### `calendar_invites`

Invite links that can be shared to let others join a calendar.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Also used as the invite token |
| `calendar_id` | `uuid` FK → `calendars` | Cascade delete |
| `expires_at` | `timestamp` | Invite expiry |
| `max_uses` | `integer` | Optional use cap; `null` = unlimited |
| `created_at` | `timestamp` | |
| `updated_at` | `timestamp` | Auto-updated |

---

## Join tables

### `calendar_members`

Which users are members of which calendars.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `text` FK → `user` | Cascade delete |
| `calendar_id` | `uuid` FK → `calendars` | Cascade delete |
| `created_at` | `timestamp` | |
| `updated_at` | `timestamp` | Auto-updated |

### `calendar_events`

Which events belong to which calendars.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `event_id` | `uuid` FK → `events` | Cascade delete |
| `calendar_id` | `uuid` FK → `calendars` | Cascade delete |
| `created_at` | `timestamp` | |
| `updated_at` | `timestamp` | Auto-updated |

### `event_users`

Which users are associated with which events (attendees).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `event_id` | `uuid` FK → `events` | Cascade delete |
| `user_id` | `text` FK → `user` | Cascade delete |
| `created_at` | `timestamp` | |
| `updated_at` | `timestamp` | Auto-updated |

---

## Entity relationships

```
user ──< session
user ──< account
user ──< verification

user ──< calendars           (creator)
user ──< calendar_members >── calendars
user ──< events              (creator)
user ──< event_users >──────── events

calendars ──< calendar_invites
calendars ──< calendar_events >── events
```

<Aside type="note">
  All `onDelete` rules are `cascade` — deleting a user removes all their calendars, sessions, and events. Deleting a calendar removes its invites, members, and event links.
</Aside>

## Migrations

Migration SQL files live in `packages/db/drizzle/`. To generate a new migration after editing the schema:

```sh
pnpm --filter @musubi/db generate
```

To apply pending migrations:

```sh
pnpm --filter @musubi/db migrate
```
