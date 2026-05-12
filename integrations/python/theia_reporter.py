"""Minimal stdlib Theia reporter for private agents.

The helper posts agent-activity/v1 events to Theia local-core. It reports safe
summaries, decision traces, and tool logs only; do not send hidden chain-of-thought.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
import uuid
from typing import Any, Dict, Iterable, Optional


DEFAULT_ENDPOINT = "http://localhost:4318/agent-network/telemetry/events"


class TheiaReporter:
    def __init__(
        self,
        agent_id: Optional[str] = None,
        token: Optional[str] = None,
        endpoint: Optional[str] = None,
        workspace_id: Optional[str] = None,
        name: Optional[str] = None,
        role: str = "Private Agent",
        domain: str = "general",
        model: Optional[str] = None,
        vendor: Optional[str] = None,
        connection_kind: str = "custom",
        timeout: float = 5.0,
    ) -> None:
        self.agent_id = agent_id or os.environ.get("THEIA_AGENT_ID") or "agent:python-reporter"
        self.token = token or os.environ.get("THEIA_AGENT_TOKEN")
        self.endpoint = endpoint or os.environ.get("THEIA_AGENT_TELEMETRY_ENDPOINT") or DEFAULT_ENDPOINT
        self.workspace_id = workspace_id or os.environ.get("THEIA_WORKSPACE_ID") or "ws_local_default"
        self.name = name or os.environ.get("THEIA_AGENT_NAME") or self.agent_id
        self.role = role
        self.domain = domain
        self.model = model
        self.vendor = vendor
        self.connection_kind = connection_kind
        self.timeout = timeout

    def report_activity(
        self,
        current_task: str,
        category: str = "operations",
        status: str = "active",
        safe_summary: Optional[str] = None,
        decision_trace: Optional[Iterable[str]] = None,
        tool: Optional[str] = None,
        target_label: Optional[str] = None,
        risk_level: str = "low",
        confidence: float = 0.82,
        usage: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        event = self.build_event(
            current_task=current_task,
            category=category,
            status=status,
            safe_summary=safe_summary,
            decision_trace=decision_trace,
            tool=tool,
            target_label=target_label,
            risk_level=risk_level,
            confidence=confidence,
            usage=usage,
        )
        return self._post(event)

    def heartbeat(self, current_task: str = "Heartbeat from private agent.") -> Dict[str, Any]:
        return self.report_activity(
            current_task=current_task,
            category="idle",
            status="idle",
            safe_summary=current_task,
            decision_trace=["Agent sent a heartbeat to Theia."],
            tool="theia_heartbeat",
            confidence=0.9,
        )

    def build_event(
        self,
        current_task: str,
        category: str,
        status: str,
        safe_summary: Optional[str],
        decision_trace: Optional[Iterable[str]],
        tool: Optional[str],
        target_label: Optional[str],
        risk_level: str,
        confidence: float,
        usage: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        return {
            "schemaVersion": "agent-activity/v1",
            "eventId": "evt:python:%s" % uuid.uuid4().hex,
            "timestamp": now,
            "workspaceId": self.workspace_id,
            "agent": {
                "agentId": self.agent_id,
                "name": self.name,
                "role": self.role,
                "domain": self.domain,
                "model": self.model,
                "vendor": self.vendor,
                "connectionKind": self.connection_kind,
            },
            "classification": {
                "category": category,
                "status": status,
                "riskLevel": risk_level,
                "confidence": confidence,
            },
            "what": {
                "currentTask": current_task,
                "safeSummary": safe_summary or current_task,
                "decisionTrace": list(decision_trace or ["Agent reported a safe activity summary."])[:8],
            },
            "where": {
                "targets": [
                    {
                        "kind": "tool" if tool else "external_service",
                        "label": target_label or tool or "private agent runtime",
                        "redacted": False,
                    }
                ]
            },
            "how": {
                "toolCalls": [
                    {
                        "name": tool or "theia_python_reporter",
                        "kind": "connector",
                        "status": "completed",
                        "safeSummary": "Reported safe activity telemetry to Theia.",
                    }
                ],
                "userVisibleExplanation": safe_summary or current_task,
            },
            "usage": usage or {},
            "privacy": {
                "redactionApplied": True,
                "sensitiveKinds": [],
            },
        }

    def _post(self, event: Dict[str, Any]) -> Dict[str, Any]:
        body = json.dumps(event).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-theia-agent-id": self.agent_id,
        }
        if self.token:
            headers["Authorization"] = "Bearer %s" % self.token
        request = urllib.request.Request(self.endpoint, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError("Theia reporter rejected event (%s): %s" % (exc.code, detail)) from exc


if __name__ == "__main__":
    reporter = TheiaReporter()
    print(json.dumps(reporter.heartbeat(), indent=2))
