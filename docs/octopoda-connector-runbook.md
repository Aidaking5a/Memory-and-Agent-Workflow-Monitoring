# Octopoda Connector Runbook

## Goal

Connect Octopoda agents to Theia as normal command-center agents: live bubbles, agent cards, stats, safe activity summaries, and visible controls.

## Local Mode

Start Theia:

```powershell
pnpm.cmd run dev:dashboard
```

Start Octopoda separately:

```powershell
py -m pip install "octopoda[server,mcp]"
octopoda
```

In Theia:

1. Open `Live Reporting Dashboard`.
2. Use `Connect Agent`.
3. Click `Discover`.
4. Pair `Octopoda Local Runtime`.
5. Click `Validate`.

The connector reads `http://localhost:7842/api/system/status` and `http://localhost:7842/api/agents`, maps registry and memory/runtime metrics to `agent-activity/v1`, and surfaces Octopoda agents in the live network.

## Cloud Mode

Cloud mode is opt-in only. Set the key before starting Theia:

```powershell
$env:THEIA_OCTOPODA_API_KEY="<your-key>"
$env:THEIA_OCTOPODA_BASE_URL="https://api.octopodas.com"
pnpm.cmd run dev:dashboard
```

Theia never returns the raw API key to the dashboard. Status responses expose only `hasSecret`.

## OpenClaw Skill Reporter

Install the Theia skill into the OpenClaw workspace:

```powershell
python ".\integrations\openclaw\theia-command-center-skill\install.py" --openclaw-path "C:\Users\admin_1\src\openclaw" --endpoint "http://localhost:4318/agent-network/telemetry/events" --agent-id "agent:openclaw"
```

Then register `agent:openclaw` in Theia and replace `THEIA_AGENT_TOKEN_FROM_DASHBOARD` in the installed `.theia-command-center.json` with the token shown once by the dashboard.

Validate:

```powershell
python "C:\Users\admin_1\src\openclaw\skills\theia-command-center\scripts\report.py" heartbeat
```

## MCP Adapter

Generate an MCP config from the `Connect Agent` panel, then paste it into a compatible client. The MCP server exposes only safe reporting/control-read tools:

- `theia_report_activity`
- `theia_heartbeat`
- `theia_read_commands`
- `theia_ack_command`
- `theia_query_status`

It does not expose arbitrary shell execution.

Self-test:

```powershell
node ".\integrations\mcp\theia-mcp-server.mjs" --self-test
```

## Recovery

- Service offline: start Octopoda or Theia local-core, then validate again.
- Auth missing: set `THEIA_OCTOPODA_API_KEY` for cloud or rotate the per-agent token.
- Schema rejected: update the adapter to emit `agent-activity/v1`.
- CORS/auth issue: use the local core endpoint or allowlist the connector origin.

## Safety Notes

- No installer silently installs Python, Octopoda, Docker, WSL, paid APIs, or cloud credentials.
- Hidden chain-of-thought must not be reported. Use safe summaries, decision traces, tool-call logs, file/site/API references, and user-visible explanations.
- Emergency-stopped agents cannot report or read commands again until the user re-enables them.
