# OpenClaw Integration Runbook (Theia)

This runbook aligns Theia local onboarding with OpenClaw Gateway operations.

## Install / Update

Recommended installer (Windows PowerShell):

```powershell
iwr -useb https://openclaw.ai/install.ps1 | iex
```

Alternative when Node is already managed:

```powershell
npm install -g openclaw@latest
openclaw onboard --install-daemon
```

## Start Gateway + Dashboard

```powershell
openclaw gateway --port 18789
openclaw dashboard
```

Default local dashboard URL:

- `http://127.0.0.1:18789/`

OpenAI-compatible API base:

- `http://localhost:18789/v1`

## Health Checks

```powershell
openclaw gateway status
openclaw status
openclaw doctor
```

## Theia Runtime Connector (Optional)

If you want runtime polling in addition to log ingestion:

- set runtime endpoint in Theia onboarding (for your gateway/API bridge)
- keep token/auth aligned with gateway auth policy
- validate with Theia `Run Health Check`

## Theia Push Telemetry Pairing (Recommended)

Theia supports authenticated push telemetry from OpenClaw (OpenClaw reports activity to Theia).

1. In Theia desktop, open `OpenClaw Operations` and create a pairing token.
2. Copy:
   - pairing id
   - token
   - endpoint (default `http://localhost:4318/openclaw/telemetry/events`)
3. Export env vars in your OpenClaw terminal:

```powershell
$env:THEIA_OPENCLAW_PAIRING_ID="pair_..."
$env:THEIA_OPENCLAW_PAIRING_TOKEN="..."
$env:THEIA_OPENCLAW_TELEMETRY_ENDPOINT="http://localhost:4318/openclaw/telemetry/events"
```

4. Register your OpenClaw hook/plugin to POST events to that endpoint.
5. Validate in Theia:
   - pairing `last used` updates
   - live stream status = `live`
   - OpenClaw telemetry history receives events

## Theia Command Center Skill

The connector strategy now includes a small OpenClaw-side skill that reports strict `agent-activity/v1` events into the main Agent Command Center.

Install into the default workspace:

```powershell
python ".\integrations\openclaw\theia-command-center-skill\install.py" --openclaw-path "C:\Users\admin_1\src\openclaw" --endpoint "http://localhost:4318/agent-network/telemetry/events" --agent-id "agent:openclaw"
```

Then register `agent:openclaw` in the Theia `Live Reporting Dashboard`, copy the shown telemetry token into the installed `.theia-command-center.json`, and validate:

```powershell
python "C:\Users\admin_1\src\openclaw\skills\theia-command-center\scripts\report.py" heartbeat
```

The skill does not expose arbitrary shell execution. It only reports safe summaries and reads visible steering commands.

Notes:

- `/v1` OpenAI-compatible endpoint is inference API, not a workflow event feed.
- Keep gateway CLI/runtime polling enabled as fallback diagnostics when needed.
- Revoke pairing tokens from Theia when rotating credentials.
- If you add a custom OpenClaw reporting tool, explicitly allowlist it in `tools.allow`; deny rules take precedence.

## Common Failure Paths

- Gateway offline: start `openclaw gateway --port 18789`
- Unauthorized / 1008: verify token/password and gateway auth mode, then reconnect
- Port conflict: use `openclaw gateway --force` or free the port manually
- Docker networking clients: use `http://host.docker.internal:18789/v1` when required

## Security Notes

- Treat dashboard as admin surface; avoid public exposure
- Prefer localhost, VPN/Tailscale, or SSH tunnel
- Keep shared secrets in environment variables / secret manager, not source files
