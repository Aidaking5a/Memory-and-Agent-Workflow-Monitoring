import type { TelemetryPairingRecord } from "./openclaw-telemetry.js";

export interface OpenClawPairingCommands {
  powershell: string[];
  bash: string[];
}

export interface OpenClawPairingCreatedResponse {
  pairingId: string;
  label: string;
  expiresAt: string;
  telemetryEndpoint: string;
  streamEndpoint: string;
  token: string;
  commands: OpenClawPairingCommands;
}

export function buildOpenClawPairingCreatedResponse(input: {
  localCoreBaseUrl: string;
  pairing: TelemetryPairingRecord;
  token: string;
  now?: Date;
}): OpenClawPairingCreatedResponse {
  return {
    pairingId: input.pairing.pairingId,
    label: input.pairing.label,
    expiresAt: input.pairing.expiresAt,
    telemetryEndpoint: `${input.localCoreBaseUrl}/openclaw/telemetry/events`,
    streamEndpoint: `${input.localCoreBaseUrl}/openclaw/telemetry/stream`,
    token: input.token,
    commands: buildOpenClawPairingCommands({
      localCoreBaseUrl: input.localCoreBaseUrl,
      pairingId: input.pairing.pairingId,
      token: input.token,
      now: input.now
    })
  };
}

export function buildOpenClawPairingCommands(input: {
  localCoreBaseUrl: string;
  pairingId: string;
  token: string;
  now?: Date;
}): OpenClawPairingCommands {
  const endpoint = `${input.localCoreBaseUrl}/openclaw/telemetry/events`;
  const payload = {
    events: [
      {
        eventType: "agent.connected",
        status: "ok",
        message: "OpenClaw pairing test event from terminal.",
        timestamp: (input.now ?? new Date()).toISOString(),
        runId: "run:openclaw",
        agentId: "agent:openclaw",
        severity: "info",
        confidence: 0.9,
        source: "openclaw-hook"
      }
    ]
  };
  return {
    powershell: [
      `$env:THEIA_OPENCLAW_PAIRING_ID='${input.pairingId}'`,
      `$env:THEIA_OPENCLAW_PAIRING_TOKEN='${input.token}'`,
      `$env:THEIA_OPENCLAW_TELEMETRY_ENDPOINT='${endpoint}'`,
      "Invoke-RestMethod -Method Post -Uri $env:THEIA_OPENCLAW_TELEMETRY_ENDPOINT -Headers @{ Authorization = \"Bearer $env:THEIA_OPENCLAW_PAIRING_TOKEN\"; \"x-theia-pairing-id\" = $env:THEIA_OPENCLAW_PAIRING_ID } -ContentType \"application/json\" -Body '{\"events\":[{\"eventType\":\"agent.connected\",\"status\":\"ok\",\"message\":\"OpenClaw pairing test event from terminal.\",\"timestamp\":\"' + (Get-Date).ToUniversalTime().ToString(\"o\") + '\",\"runId\":\"run:openclaw\",\"agentId\":\"agent:openclaw\",\"severity\":\"info\",\"confidence\":0.9,\"source\":\"openclaw-hook\"}]}'"
    ],
    bash: [
      `export THEIA_OPENCLAW_PAIRING_ID='${input.pairingId}'`,
      `export THEIA_OPENCLAW_PAIRING_TOKEN='${input.token}'`,
      `export THEIA_OPENCLAW_TELEMETRY_ENDPOINT='${endpoint}'`,
      `curl -X POST "$THEIA_OPENCLAW_TELEMETRY_ENDPOINT" -H "Authorization: Bearer $THEIA_OPENCLAW_PAIRING_TOKEN" -H "x-theia-pairing-id: $THEIA_OPENCLAW_PAIRING_ID" -H "Content-Type: application/json" -d '${JSON.stringify(payload)}'`
    ]
  };
}
