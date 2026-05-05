---
title: Running Locally
description: How to run the Musubi client and server on your machine.
---

import { Aside } from '@astrojs/starlight/components';

## Prerequisites

- Node.js 20+
- pnpm 10+
- Postgres 15+
- [Expo Go](https://expo.dev/go) on your phone, or an Android/iOS simulator

## Install dependencies

From the monorepo root:

```sh
pnpm install
```

## Environment variables

Musubi uses a single `.env` file at the monorepo root, shared across all apps and packages. Copy the example:

```sh
cp .env.example .env
```

At minimum, set `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `API_URL`. See `.env.example` for the full list of keys.

## Run database migrations

```sh
pnpm db:migrate
```

## Start everything

From the monorepo root:

```sh
pnpm dev
```

This runs the API, the Expo client, and the docs site in parallel using Turborepo's interactive TUI — each app's output gets its own pane. Pass `--ui=stream` if you'd rather have plain streamed output.

To start a single app instead, `cd` into its directory and run `pnpm dev` there:

```sh
cd apps/api && pnpm dev        # API only
cd apps/client && pnpm dev     # Expo client only
cd packages/docs && pnpm dev   # Docs only
```

The API runs on `http://localhost:3000` by default (configurable via `API_SERVER_PORT`). The Expo dev server prints a QR code — scan it with Expo Go, or press `i` / `a` for an iOS / Android simulator.

<Aside type="tip">
  When testing the client on a real device (not a simulator), set `API_URL` in the root `.env` to your machine's LAN IP — e.g. `http://192.168.1.42:3000`, not `localhost`. A simulator can use `localhost` directly.
</Aside>

<Aside type="note">
  Musubi is an early MVP. Some flows may be incomplete or require manual steps.
</Aside>
