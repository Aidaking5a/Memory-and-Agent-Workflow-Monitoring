/**
 * OpenClaw hook starter for Theia push telemetry.
 *
 * This file is intentionally generic so teams can adapt it to their OpenClaw hook runtime.
 * It expects environment variables:
 * - THEIA_OPENCLAW_TELEMETRY_ENDPOINT
 * - THEIA_OPENCLAW_PAIRING_TOKEN
 * - THEIA_OPENCLAW_PAIRING_ID
 */

interface HookContext {
  eventType?: string;
  status?: string;
  message?: string;
  timestamp?: string;
  runId?: string;
  agentId?: string;
  taskId?: string;
  severity?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
  memorySummary?: Record<string, unknown>;
  logSummary?: Record<string, unknown>;
}

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalize(input: HookContext): Record<string, unknown> {
  const message = typeof input.message === "string" && input.message.trim().length > 0 ? input.message : "OpenClaw hook event";
  return {
    eventType: typeof input.eventType === "string" ? input.eventType : "task.updated",
    status: typeof input.status === "string" ? input.status : "ok",
    message,
    timestamp: typeof input.timestamp === "string" ? input.timestamp : nowIso(),
    runId: typeof input.runId === "string" ? input.runId : "run:openclaw",
    agentId: typeof input.agentId === "string" ? input.agentId : "agent:openclaw",
    taskId: typeof input.taskId === "string" ? input.taskId : undefined,
    severity: typeof input.severity === "string" ? input.severity : "info",
    confidence: typeof input.confidence === "number" ? input.confidence : 0.8,
    source: "openclaw-hook",
    metadata: input.metadata ?? {},
    memorySummary: input.memorySummary,
    logSummary: input.logSummary
  };
}

export default async function reportToTheia(context: HookContext): Promise<void> {
  const endpoint = env("THEIA_OPENCLAW_TELEMETRY_ENDPOINT");
  const token = env("THEIA_OPENCLAW_PAIRING_TOKEN");
  const pairingId = env("THEIA_OPENCLAW_PAIRING_ID");
  const payload = {
    events: [normalize(context)]
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-theia-pairing-id": pairingId,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Theia telemetry ingestion failed (${response.status}): ${text}`);
  }
}

