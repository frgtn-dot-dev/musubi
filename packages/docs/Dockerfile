FROM node:lts AS runtime
WORKDIR /app

COPY . .

RUN npm install -g pnpm
RUN pnpm install
RUN pnpm --filter @musubi/docs run build

ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
