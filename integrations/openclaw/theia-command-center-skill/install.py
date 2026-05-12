#!/usr/bin/env python
"""Install the Theia Command Center skill into an OpenClaw workspace.

This script copies a small reporter skill only. It does not install Python,
Docker, WSL, Octopoda, paid APIs, or cloud credentials.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path


def default_openclaw_path() -> Path:
    return Path(os.environ.get("THEIA_OPENCLAW_WORKSPACE_PATH") or Path.home() / "src" / "openclaw")


def copytree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def main() -> int:
    parser = argparse.ArgumentParser(description="Install Theia Command Center OpenClaw skill.")
    parser.add_argument("--openclaw-path", default=str(default_openclaw_path()), help="OpenClaw workspace path.")
    parser.add_argument("--endpoint", default="http://localhost:4318/agent-network/telemetry/events", help="Theia telemetry endpoint.")
    parser.add_argument("--commands-endpoint", default="http://localhost:4318/agent-network/commands", help="Theia command-read endpoint.")
    parser.add_argument("--agent-id", default="agent:openclaw", help="Registered Theia agent id.")
    parser.add_argument("--token", default=os.environ.get("THEIA_AGENT_TOKEN"), help="Optional Theia agent token.")
    args = parser.parse_args()

    source = Path(__file__).resolve().parent / "theia-command-center"
    openclaw_path = Path(args.openclaw_path).expanduser().resolve()
    if not openclaw_path.exists():
        raise SystemExit(f"OpenClaw path does not exist: {openclaw_path}")

    skill_root = openclaw_path / "skills"
    target = skill_root / "theia-command-center"
    skill_root.mkdir(parents=True, exist_ok=True)
    copytree(source, target)

    config = {
        "endpoint": args.endpoint,
        "commandsEndpoint": args.commands_endpoint,
        "agentId": args.agent_id,
        "token": args.token or "THEIA_AGENT_TOKEN_FROM_DASHBOARD",
        "workspaceId": os.environ.get("THEIA_WORKSPACE_ID", "ws_local_default"),
    }
    (target / ".theia-command-center.json").write_text(json.dumps(config, indent=2), encoding="utf-8")

    print("Theia Command Center skill installed.")
    print(f"Target: {target}")
    print("Validate:")
    print(f'  python "{target / "scripts" / "report.py"}" heartbeat')
    print("Token note: replace THEIA_AGENT_TOKEN_FROM_DASHBOARD in .theia-command-center.json with the token shown once in Theia.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
