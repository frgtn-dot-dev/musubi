FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS base
RUN corepack enable
WORKDIR /repo

# Build a portable API production closure from the workspace lockfile. `deploy`
# isolates the selected package's peer graph, so Drizzle's client-side
# expo-sqlite context cannot pull Expo/React Native into the server image.
# Injecting workspace packages is scoped to deployment; local development keeps
# normal linked workspaces. `--prod` excludes drizzle-kit, Turbo, TypeScript and
# @types. The runtime still contains tsx and drizzle-orm for source execution
# and boot-time migrations.
FROM base AS deploy
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api apps/api
COPY packages/db packages/db
COPY packages/auth packages/auth
COPY packages/types packages/types
COPY packages/config packages/config
RUN pnpm --config.inject-workspace-packages=true --filter @musubi/api \
      deploy --prod --frozen-lockfile /prod/api

# Runtime carries only the portable deployment (no pnpm store, Corepack, client,
# docs, or monorepo source tree). Migrations execute from the injected db
# package before the API starts.
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runner
WORKDIR /app
COPY --from=deploy /prod/api /app
ENV NODE_ENV=production

ARG API_SERVER_PORT=7531
EXPOSE ${API_SERVER_PORT} 9464

# Invoke tsx directly (no pnpm/Corepack or network access at boot).
CMD ["sh", "-c", "node_modules/.bin/tsx node_modules/@musubi/db/src/migrate.ts && node_modules/.bin/tsx src/index.ts"]
