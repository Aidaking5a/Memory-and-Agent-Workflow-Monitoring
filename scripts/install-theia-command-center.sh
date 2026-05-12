#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${HOME}/TheiaCommandCenter"
REPO_URL="https://github.com/aidaking5a/Memory-and-Agent-Workflow-Monitoring.git"
BRANCH="main"
YES=0
BUILD_DASHBOARD=0
START_AFTER_INSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --repo-url)
      REPO_URL="$2"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --yes)
      YES=1
      shift
      ;;
    --build-dashboard)
      BUILD_DASHBOARD=1
      shift
      ;;
    --start-after-install)
      START_AFTER_INSTALL=1
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

run_checked() {
  echo "[theia-install] $*"
  "$@"
}

require_command git
require_command node
require_command pnpm

INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}"
INSTALL_PARENT="$(dirname "$INSTALL_DIR")"
INSTALL_BASE="$(basename "$INSTALL_DIR")"
mkdir -p "$INSTALL_PARENT"
INSTALL_DIR="$(cd "$INSTALL_PARENT" && pwd -P)/${INSTALL_BASE}"

echo ""
echo "Theia Agent Command Center Apple/macOS installer"
echo "This script is local-first and reversible. It will not install Node, pnpm, Git, Rust, Docker, WSL, paid APIs, or cloud credentials."
echo ""
echo "Plan:"
echo "  Install directory: ${INSTALL_DIR}"
echo "  Repository:        ${REPO_URL}"
echo "  Branch:            ${BRANCH}"
echo "  Build dashboard:   ${BUILD_DASHBOARD}"
echo "  Start services:    ${START_AFTER_INSTALL}"
echo ""

if [[ "$YES" != "1" ]]; then
  read -r -p "Continue? Type YES " answer
  if [[ "$answer" != "YES" ]]; then
    echo "Cancelled."
    exit 0
  fi
fi

if [[ -d "$INSTALL_DIR" ]]; then
  if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
    echo "Install directory exists but is not a Git repository: ${INSTALL_DIR}" >&2
    exit 1
  fi
  run_checked git -C "$INSTALL_DIR" fetch --tags origin
  run_checked git -C "$INSTALL_DIR" checkout "$BRANCH"
  run_checked git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
else
  run_checked git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$INSTALL_DIR"
fi

mkdir -p "${INSTALL_DIR}/.theia"
cat >"${INSTALL_DIR}/.theia/install-manifest.json" <<JSON
{
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "installDir": "${INSTALL_DIR}",
  "repoUrl": "${REPO_URL}",
  "branch": "${BRANCH}",
  "node": "$(node --version)",
  "pnpm": "$(pnpm --version)",
  "platform": "$(uname -s)"
}
JSON

cd "$INSTALL_DIR"
if [[ -f pnpm-lock.yaml ]]; then
  run_checked pnpm install --frozen-lockfile
else
  run_checked pnpm install --no-frozen-lockfile
fi

run_checked pnpm --filter @theia/agent-protocol build

if [[ "$BUILD_DASHBOARD" == "1" ]]; then
  run_checked pnpm --filter @theia/local-core build
  run_checked pnpm --filter @theia/desktop build
fi

echo ""
echo "Theia Agent Command Center is installed."
echo "Manifest: ${INSTALL_DIR}/.theia/install-manifest.json"
echo ""
echo "Start locally:"
echo "  cd \"${INSTALL_DIR}\""
echo "  bash ./scripts/start-theia-dashboard.sh --openclaw-path \"${HOME}/src/openclaw\""
echo ""
echo "Reversible cleanup:"
echo "  1. Stop local Theia node processes after reviewing them."
echo "  2. Remove the install directory after saving any local .theia state you want to keep."

if [[ "$START_AFTER_INSTALL" == "1" ]]; then
  run_checked bash ./scripts/start-theia-dashboard.sh --openclaw-path "${HOME}/src/openclaw"
fi
