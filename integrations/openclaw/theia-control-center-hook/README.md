# Theia OpenClaw Push Telemetry Hook (Starter)

This starter hook sends authenticated OpenClaw activity events to Theia local-core.

It supports two targets:

- OpenClaw Operations telemetry: `POST /openclaw/telemetry/events`
- Agent Command Center telemetry: `POST /agent-network/telemetry/events`

## 1) Create a pairing token in Theia

Open Theia desktop `OpenClaw Operations` and click `Create Pairing Token`.

Copy:

- `pairingId`
- `token`
- telemetry endpoint (default): `http://localhost:4318/openclaw/telemetry/events`

## 2) Export env vars in your OpenClaw terminal

PowerShell:

```powershell
$env:THEIA_OPENCLAW_PAIRING_ID="pair_..."
$env:THEIA_OPENCLAW_PAIRING_TOKEN="..."
$env:THEIA_OPENCLAW_TELEMETRY_ENDPOINT="http://localhost:4318/openclaw/telemetry/events"
```

Bash:

```bash
export THEIA_OPENCLAW_PAIRING_ID="pair_..."
export THEIA_OPENCLAW_PAIRING_TOKEN="..."
export THEIA_OPENCLAW_TELEMETRY_ENDPOINT="http://localhost:4318/openclaw/telemetry/events"
```

For the Agent Command Center protocol, register OpenClaw as an agent in Theia's Agent view and export:

PowerShell:

```powershell
$env:THEIA_AGENT_ID="agent:openclaw"
$env:THEIA_AGENT_TOKEN="theia_agent_..."
$env:THEIA_AGENT_TELEMETRY_ENDPOINT="http://localhost:4318/agent-network/telemetry/events"
```

Bash:

```bash
export THEIA_AGENT_ID="agent:openclaw"
export THEIA_AGENT_TOKEN="theia_agent_..."
export THEIA_AGENT_TELEMETRY_ENDPOINT="http://localhost:4318/agent-network/telemetry/events"
```

When both target families are configured, this starter sends the stricter command-center event first. Keep the older OpenClaw pairing variables for legacy Operations telemetry if needed.

## 3) Register this hook

Use your OpenClaw hook registration command to point to `handler.ts`.

If your OpenClaw deployment supports typed hook triggers, bind at least:

- gateway start / stop
- task updates
- tool start / complete / fail
- memory update checkpoints

## 4) Validate connectivity

Run OpenClaw, trigger a task, then check Theia:

- OpenClaw Operations view updates in near real time
- Pairing `lastUsedAt` timestamp moves
- Push telemetry history shows new events

## Security notes

- Pairing token is a secret; rotate/revoke if exposed.
- Agent telemetry tokens are per-agent secrets; emergency stop revokes the active token.
- Theia validates payload size, schema shape, and rate limits.
- Secrets and local paths are redacted in stored telemetry metadata.
- The hook emits safe summaries and decision traces, not hidden chain-of-thought.
