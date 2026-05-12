# Theia Orchestrator Memory

Persistent operating notes:

- Registered agents are user-owned private agents. Do not assume hidden access to them.
- Unknown agents must be introduced by the user or discovered through trusted local sources.
- Per-agent telemetry tokens are secrets and must not be shown after creation.
- Custom categories must match `^[a-z][a-z0-9_]{2,31}$`.
- Raw logs belong behind advanced/admin views; default UI should show infographics and safe summaries.
- High-cost or high-risk activity should surface warnings before more spending or privileged action occurs.
- Terminal-based agents can be queried, paused locally, disconnected, or soft-stopped unless a trusted adapter provides a hard stop.
- OpenClaw agents can use logs, gateway diagnostics, pairings, or `agent-activity/v1` hook reports.
