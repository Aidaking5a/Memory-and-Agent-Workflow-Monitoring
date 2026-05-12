#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict


def load_config() -> Dict[str, Any]:
    config_path = Path(__file__).resolve().parent.parent / ".theia-command-center.json"
    config: Dict[str, Any] = {}
    if config_path.exists():
        config = json.loads(config_path.read_text(encoding="utf-8"))
    return {
        "endpoint": os.environ.get("THEIA_AGENT_TELEMETRY_ENDPOINT") or config.get("endpoint") or "http://localhost:4318/agent-network/telemetry/events",
        "commandsEndpoint": os.environ.get("THEIA_AGENT_COMMANDS_ENDPOINT") or config.get("commandsEndpoint") or "http://localhost:4318/agent-network/commands",
        "agentId": os.environ.get("THEIA_AGENT_ID") or config.get("agentId") or "agent:openclaw",
        "token": os.environ.get("THEIA_AGENT_TOKEN") or config.get("token"),
        "workspaceId": os.environ.get("THEIA_WORKSPACE_ID") or config.get("workspaceId") or "ws_local_default",
    }


def headers(config: Dict[str, Any]) -> Dict[str, str]:
    next_headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "x-theia-agent-id": config["agentId"],
    }
    token = config.get("token")
    if token and token != "THEIA_AGENT_TOKEN_FROM_DASHBOARD":
        next_headers["Authorization"] = "Bearer %s" % token
    return next_headers


def request_json(url: str, config: Dict[str, Any], method: str = "GET", body: Dict[str, Any] | None = None) -> Dict[str, Any]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers(config), method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError("Theia request failed (%s): %s" % (exc.code, detail)) from exc


def event(config: Dict[str, Any], args: argparse.Namespace) -> Dict[str, Any]:
    task = args.task or "OpenClaw heartbeat to Theia."
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return {
        "schemaVersion": "agent-activity/v1",
        "eventId": "evt:openclaw-skill:%s" % uuid.uuid4().hex,
        "timestamp": now,
        "workspaceId": config["workspaceId"],
        "agent": {
            "agentId": config["agentId"],
            "name": args.name or "OpenClaw",
            "role": args.role or "OpenClaw Agent Network",
            "domain": args.domain or "openclaw",
            "model": args.model,
            "vendor": args.vendor or "OpenClaw",
            "connectionKind": "openclaw",
        },
        "classification": {
            "category": args.category,
            "status": args.status,
            "riskLevel": args.risk_level,
            "confidence": 0.86,
        },
        "what": {
            "currentTask": task,
            "safeSummary": args.summary or task,
            "decisionTrace": [
                "OpenClaw skill prepared a safe Theia report.",
                "The report excludes hidden chain-of-thought and raw secrets.",
            ],
        },
        "where": {
            "targets": [
                {
                    "kind": "openclaw_session",
                    "label": args.target or "OpenClaw local workspace",
                    "redacted": False,
                }
            ]
        },
        "how": {
            "toolCalls": [
                {
                    "name": "theia_command_center_skill",
                    "kind": "skill",
                    "status": "completed",
                    "safeSummary": "OpenClaw activity was reported to Theia.",
                }
            ],
            "userVisibleExplanation": args.summary or task,
        },
        "usage": {},
        "privacy": {
            "redactionApplied": True,
            "sensitiveKinds": [],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Report OpenClaw activity to Theia.")
    sub = parser.add_subparsers(dest="command", required=True)
    heartbeat = sub.add_parser("heartbeat")
    heartbeat.set_defaults(task="OpenClaw heartbeat to Theia.", category="idle", status="idle")
    activity = sub.add_parser("activity")
    activity.add_argument("--task", required=True)
    activity.add_argument("--category", default="operations")
    activity.add_argument("--status", default="active")
    commands = sub.add_parser("commands")
    ack = sub.add_parser("ack")
    ack.add_argument("--command-id", required=True)
    ack.add_argument("--status", default="accepted")
    ack.add_argument("--result-summary")

    for cmd in [heartbeat, activity]:
        cmd.add_argument("--summary")
        cmd.add_argument("--target")
        cmd.add_argument("--name")
        cmd.add_argument("--role")
        cmd.add_argument("--domain")
        cmd.add_argument("--model")
        cmd.add_argument("--vendor")
        cmd.add_argument("--risk-level", default="low")

    args = parser.parse_args()
    config = load_config()
    if args.command in ("heartbeat", "activity"):
        print(json.dumps(request_json(config["endpoint"], config, "POST", event(config, args)), indent=2))
    elif args.command == "commands":
        url = config["commandsEndpoint"] + "?" + urllib.parse.urlencode({"agentId": config["agentId"]})
        print(json.dumps(request_json(url, config), indent=2))
    elif args.command == "ack":
        base = config["commandsEndpoint"].rstrip("/")
        body = {"agentId": config["agentId"], "status": args.status, "resultSummary": args.result_summary}
        print(json.dumps(request_json("%s/%s/ack" % (base, urllib.parse.quote(args.command_id)), config, "POST", body), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
