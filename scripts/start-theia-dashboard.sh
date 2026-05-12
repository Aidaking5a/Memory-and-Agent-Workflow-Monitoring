#!/usr/bin/env bash
set -euo pipefail

CORE_PORT=4318
DASHBOARD_PORT=5173
NO_BROWSER=0
OPENCLAW_PATH="${HOME}/src/openclaw"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --core-port)
      CORE_PORT="$2"
      shift 2
      ;;
    --dashboard-port)
      DASHBOARD_PORT="$2"
      shift 2
      ;;
    --openclaw-path)
      OPENCLAW_PATH="$2"
      shift 2
      ;;
    --no-browser)
      NO_BROWSER=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command '$1'. Install it manually, then rerun this script." >&2
    exit 1
  fi
}

port_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_http_ready() {
  local url="$1"
  local deadline=$((SECONDS + 35))
  until curl -fsS "$url" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      return 1
    fi
    sleep 0.5
  done
}

open_url() {
  if [[ "$NO_BROWSER" == "1" ]]; then
    return
  fi
  if [[ "$(uname -s)" == "Darwin" ]]; then
    open "$1" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$1" >/dev/null 2>&1 || true
  fi
}

require_command pnpm
require_command lsof
require_command curl

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${PROJECT_ROOT}/.theia/dev-logs"
mkdir -p "$LOG_DIR"

if [[ "$OPENCLAW_PATH" != /* ]]; then
  OPENCLAW_PATH="$(cd "$(dirname "$OPENCLAW_PATH")" 2>/dev/null && pwd)/$(basename "$OPENCLAW_PATH")"
fi

APPROVED_PATHS="$PROJECT_ROOT"
if [[ -e "$OPENCLAW_PATH" ]]; then
  APPROVED_PATHS="${PROJECT_ROOT},${OPENCLAW_PATH}"
fi

ALLOWED_ORIGINS="http://localhost:${DASHBOARD_PORT},http://127.0.0.1:${DASHBOARD_PORT},http://localhost:4173,http://127.0.0.1:4173"

echo "Theia dashboard Apple/macOS one-liner"
echo "Project root: ${PROJECT_ROOT}"
echo "OpenClaw path: ${OPENCLAW_PATH}"
echo "Allowed dashboard origins: ${ALLOWED_ORIGINS}"
echo "Logs: ${LOG_DIR}"

if ! port_listening "$CORE_PORT"; then
  echo "Starting local-core on port ${CORE_PORT}..."
  (
    cd "$PROJECT_ROOT"
    env \
      THEIA_CORE_PORT="$CORE_PORT" \
      THEIA_ALLOWED_ORIGINS="$ALLOWED_ORIGINS" \
      THEIA_OPENCLAW_WORKSPACE_PATH="$OPENCLAW_PATH" \
      THEIA_OPENCLAW_DISCOVERY_PATHS="$OPENCLAW_PATH" \
      THEIA_APPROVED_PATHS="$APPROVED_PATHS" \
      THEIA_OPENCLAW_LOG_SOURCES="$OPENCLAW_PATH" \
      pnpm --filter @theia/local-core run dev
  ) >"${LOG_DIR}/dashboard-local-core.log" 2>&1 &
else
  echo "local-core is already listening on port ${CORE_PORT}."
fi

if ! port_listening "$DASHBOARD_PORT"; then
  echo "Starting desktop dashboard on port ${DASHBOARD_PORT}..."
  (
    cd "$PROJECT_ROOT"
    env VITE_THEIA_CORE_URL="http://localhost:${CORE_PORT}" \
      pnpm --filter @theia/desktop run dev -- --host 127.0.0.1 --port "$DASHBOARD_PORT"
  ) >"${LOG_DIR}/dashboard-vite.log" 2>&1 &
else
  echo "Dashboard is already listening on port ${DASHBOARD_PORT}."
fi

CORE_READY=0
DASHBOARD_READY=0
if wait_http_ready "http://localhost:${CORE_PORT}/health"; then CORE_READY=1; fi
if wait_http_ready "http://localhost:${DASHBOARD_PORT}"; then DASHBOARD_READY=1; fi

echo ""
echo "Dashboard infrastructure:"
echo "  Local core: http://localhost:${CORE_PORT} (${CORE_READY})"
echo "  Dashboard:  http://localhost:${DASHBOARD_PORT} (${DASHBOARD_READY})"
echo "  Stop:       pkill -f 'theia/local-core|theia/desktop|vite' after reviewing running processes"

if [[ "$DASHBOARD_READY" == "1" ]]; then
  open_url "http://localhost:${DASHBOARD_PORT}"
fi

if [[ "$CORE_READY" != "1" || "$DASHBOARD_READY" != "1" ]]; then
  exit 1
fi
