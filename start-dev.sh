#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
ADMIN_PORT="${ADMIN_PORT:-8001}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-1}"

PIDS=()

log() {
  printf '\033[1;34m[dev]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[dev]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[dev]\033[0m %s\n' "$*" >&2
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

port_in_use() {
  local port="$1"
  has_cmd lsof && lsof -PiTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1
}

cleanup() {
  if ((${#PIDS[@]} > 0)); then
    log "Stopping dev processes..."
    kill "${PIDS[@]}" >/dev/null 2>&1 || true
    wait "${PIDS[@]}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

cd "$ROOT_DIR"

if port_in_use "$BACKEND_PORT"; then
  fail "Port $BACKEND_PORT is already in use. Set BACKEND_PORT=xxxx or stop the existing process."
fi

if port_in_use "$ADMIN_PORT"; then
  fail "Port $ADMIN_PORT is already in use. Set ADMIN_PORT=xxxx or stop the existing process."
fi

if [[ ! -f "$ROOT_DIR/server/.env" && -f "$ROOT_DIR/server/.env.example" ]]; then
  log "Creating server/.env from server/.env.example..."
  cp "$ROOT_DIR/server/.env.example" "$ROOT_DIR/server/.env"
fi

if [[ ! -d "$ROOT_DIR/server/.venv" ]]; then
  log "Installing backend dependencies..."
  (cd "$ROOT_DIR/server" && uv sync)
fi

if [[ "$RUN_MIGRATIONS" == "1" ]]; then
  log "Running backend migrations..."
  (cd "$ROOT_DIR/server" && uv run alembic upgrade head)
fi

if [[ ! -d "$ROOT_DIR/admin/node_modules" ]]; then
  log "Installing admin dependencies..."
  (cd "$ROOT_DIR/admin" && pnpm install)
fi

log "Starting backend: http://$BACKEND_HOST:$BACKEND_PORT"
(
  cd "$ROOT_DIR/server"
  uv run uvicorn app.main:app --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT"
) &
PIDS+=("$!")

log "Starting admin: http://127.0.0.1:$ADMIN_PORT"
(
  cd "$ROOT_DIR/admin"
  API_PROXY_TARGET="http://$BACKEND_HOST:$BACKEND_PORT" PORT="$ADMIN_PORT" pnpm run dev
) &
PIDS+=("$!")

log "Ready. Press Ctrl+C to stop backend and admin."
while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      wait "$pid" || true
      exit 1
    fi
  done
  sleep 1
done
