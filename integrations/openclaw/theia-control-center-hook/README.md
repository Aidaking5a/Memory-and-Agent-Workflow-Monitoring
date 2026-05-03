# Theia OpenClaw Push Telemetry Hook (Starter)

This starter hook sends authenticated OpenClaw activity events to Theia local-core.

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
- Theia validates payload size, schema shape, and rate limits.
- Secrets and local paths are redacted in stored telemetry metadata.
