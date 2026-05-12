#!/usr/bin/env bash
set -euo pipefail

PORT=4173
NO_BROWSER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="$2"
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
  local deadline=$((SECONDS + 30))
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
SITE_ROOT="${PROJECT_ROOT}/website/site"
LOG_DIR="${PROJECT_ROOT}/.theia/dev-logs"

if [[ ! -f "${SITE_ROOT}/index.html" ]]; then
  echo "Marketing site root is missing: ${SITE_ROOT}" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"

echo "Theia marketing site Apple/macOS one-liner"
echo "Project root: ${PROJECT_ROOT}"
echo "Site root: ${SITE_ROOT}"
echo "Logs: ${LOG_DIR}"

if ! port_listening "$PORT"; then
  echo "Starting marketing site on port ${PORT}..."
  (
    cd "$PROJECT_ROOT"
    env THEIA_WEBSITE_PORT="$PORT" pnpm run dev:website
  ) >"${LOG_DIR}/marketing-site.log" 2>&1 &
else
  echo "Marketing site is already listening on port ${PORT}."
fi

URL="http://localhost:${PORT}"
READY=0
if wait_http_ready "$URL"; then READY=1; fi

echo ""
echo "Marketing site infrastructure:"
echo "  Website: ${URL} (${READY})"
echo "  Home:    ${URL}/"
echo "  Contact: ${URL}/contact.html"

if [[ "$READY" == "1" ]]; then
  open_url "$URL"
else
  exit 1
fi
