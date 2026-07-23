FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS build
RUN corepack enable
WORKDIR /repo

# Build a portable docs production closure from the workspace lockfile.
# Corepack reads the exact pnpm version from the root manifest; the deployed
# package has no partial-workspace state or global pnpm installation.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/docs packages/docs
RUN pnpm --config.inject-workspace-packages=true --filter @musubi/docs \
      deploy --prod --frozen-lockfile /prod/docs
WORKDIR /prod/docs
RUN node_modules/.bin/astro build

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runner
WORKDIR /app
COPY --from=build /prod/docs /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
