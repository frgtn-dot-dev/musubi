FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS base
RUN corepack enable
WORKDIR /repo

# The web build needs dev dependencies (Vite, the TanStack Start plugin, Nitro),
# so this stage installs the full workspace graph rather than a --prod closure
# like the API image. Only the build artifact reaches the runtime.
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web apps/web
COPY packages/calendar packages/calendar
COPY packages/types packages/types
RUN pnpm --filter @musubi/web... install --frozen-lockfile
RUN pnpm --filter @musubi/web build

# Nitro emits a self-contained bundle: .output/server carries its own
# node_modules, so the runtime needs neither pnpm nor the monorepo source.
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runner
WORKDIR /app
COPY --from=build /repo/apps/web/.output /app/.output
ENV NODE_ENV=production

# The server reads PORT and binds all interfaces.
ARG PORT=3000
ENV PORT=${PORT}
EXPOSE ${PORT}

# No API_URL: the browser calls /api/* on the same public origin, which the
# reverse proxy routes to the API. This container never talks to the API itself.
CMD ["node", ".output/server/index.mjs"]
