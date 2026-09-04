#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
RADICALE_COMPOSE=${RADICALE_COMPOSE:-$HOME/workspace/radicale/compose.yaml}
DB_CONTAINER="musubi-task-e2e-db-$$"
API_LOG=$(mktemp)
API_PID=

cleanup() {
  if [[ -n "$API_PID" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
    wait "$API_PID" >/dev/null 2>&1 || true
  fi
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
  rm -f "$API_LOG"
}
trap cleanup EXIT

if [[ ! -f "$RADICALE_COMPOSE" ]]; then
  echo "Radicale compose file not found: $RADICALE_COMPOSE" >&2
  exit 1
fi
if ss -ltnH 'sport = :7531' | grep -q .; then
  echo "Port 7531 is already in use; refusing to test against an unknown API/database." >&2
  exit 1
fi

docker compose -f "$RADICALE_COMPOSE" up -d >/dev/null
docker run --rm -d --name "$DB_CONTAINER" \
  -e POSTGRES_USER=musubi \
  -e POSTGRES_PASSWORD=musubi-test \
  -e POSTGRES_DB=musubi_task_e2e \
  -p 127.0.0.1::5432 \
  postgres:17-alpine >/dev/null

DB_PORT=$(docker port "$DB_CONTAINER" 5432/tcp | awk -F: 'NR == 1 { print $NF }')
for _ in $(seq 1 30); do
  docker exec "$DB_CONTAINER" pg_isready -U musubi -d musubi_task_e2e >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$DB_CONTAINER" pg_isready -U musubi -d musubi_task_e2e >/dev/null 2>&1 || {
  echo "PostgreSQL did not become ready." >&2
  exit 1
}

export DATABASE_URL="postgresql://musubi:musubi-test@127.0.0.1:$DB_PORT/musubi_task_e2e"
export ENVIRONMENT=dev
export BETTER_AUTH_URL=http://127.0.0.1:7531
export BETTER_AUTH_SECRET=task-e2e-secret-with-at-least-32-characters
export CALDAV_ENC_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
export FEDERATION_ALLOW_PRIVATE_HOSTS=true
export EXTERNAL_SYNC_INTERVAL_MIN=0
export REQUIRE_EMAIL_VERIFICATION=false

cd "$ROOT"
pnpm --filter @musubi/api exec tsx src/index.ts >"$API_LOG" 2>&1 &
API_PID=$!
for _ in $(seq 1 60); do
  if curl --silent --fail http://127.0.0.1:7531/api/v1/server/ok >/dev/null; then
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    cat "$API_LOG" >&2
    exit 1
  fi
  sleep 1
done
curl --silent --fail http://127.0.0.1:7531/api/v1/server/ok >/dev/null || {
  cat "$API_LOG" >&2
  exit 1
}

if ! RADICALE_E2E=true pnpm --filter @musubi/web exec playwright test \
  e2e/task-radicale.spec.ts --workers=1; then
  cat "$API_LOG" >&2
  exit 1
fi
