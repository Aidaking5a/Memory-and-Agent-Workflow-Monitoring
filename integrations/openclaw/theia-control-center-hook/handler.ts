/**
 * OpenClaw hook starter for Theia push telemetry.
 *
 * This file is intentionally generic so teams can adapt it to their OpenClaw hook runtime.
 * It expects environment variables:
 * - THEIA_OPENCLAW_TELEMETRY_ENDPOINT
 * - THEIA_OPENCLAW_PAIRING_TOKEN
 * - THEIA_OPENCLAW_PAIRING_ID
 *
 * Optional command-center protocol variables:
 * - THEIA_AGENT_TELEMETRY_ENDPOINT
 * - THEIA_AGENT_TOKEN
 * - THEIA_AGENT_ID
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
  category?: string;
  currentTask?: string;
  objective?: string;
  model?: string;
  vendor?: string;
  toolName?: string;
  filesAccessed?: string[];
  websitesVisited?: string[];
  apiCalls?: string[];
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
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

function envOptional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
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

function normalizeAgentActivity(input: HookContext): Record<string, unknown> {
  const agentId = envOptional("THEIA_AGENT_ID") ?? input.agentId ?? "agent:openclaw";
  const timestamp = typeof input.timestamp === "string" ? input.timestamp : nowIso();
  const category = normalizeCategory(input.category, input.eventType, input.status);
  const status = normalizeStatus(input.status, input.eventType);
  const toolName = typeof input.toolName === "string" ? input.toolName : undefined;
  const inputTokens = typeof input.inputTokens === "number" ? input.inputTokens : undefined;
  const outputTokens = typeof input.outputTokens === "number" ? input.outputTokens : undefined;
  return {
    schemaVersion: "agent-activity/v1",
    eventId: `${agentId}:${timestamp}:${Math.random().toString(36).slice(2, 10)}`,
    timestamp,
    workspaceId: process.env.THEIA_WORKSPACE_ID ?? "ws_local_default",
    runId: typeof input.runId === "string" ? input.runId : "run:openclaw",
    taskId: typeof input.taskId === "string" ? input.taskId : undefined,
    agent: {
      agentId,
      name: process.env.THEIA_AGENT_NAME ?? "OpenClaw",
      role: "OpenClaw Agent",
      domain: "openclaw",
      model: input.model,
      vendor: input.vendor ?? "OpenClaw",
      connectionKind: "openclaw"
    },
    classification: {
      category,
      status,
      riskLevel: normalizeRisk(input.severity),
      confidence: typeof input.confidence === "number" ? input.confidence : 0.8
    },
    what: {
      objective: input.objective,
      currentTask: input.currentTask,
      safeSummary: typeof input.message === "string" && input.message.trim().length > 0 ? input.message : "OpenClaw activity update",
      decisionTrace: [
        "OpenClaw hook reported activity through the Theia command-center protocol.",
        `Event classification: ${category} / ${status}.`
      ]
    },
    where: {
      targets: [
        {
          kind: "openclaw_session",
          label: typeof input.runId === "string" ? input.runId : "OpenClaw session",
          ref: typeof input.taskId === "string" ? input.taskId : undefined,
          redacted: false
        }
      ]
    },
    how: {
      toolCalls: toolName
        ? [
            {
              name: toolName,
              kind: "tool",
              status: status === "failed" ? "failed" : "completed",
              safeSummary: input.message
            }
          ]
        : [],
      filesAccessed: input.filesAccessed ?? [],
      websitesVisited: input.websitesVisited ?? [],
      apiCalls: input.apiCalls ?? [],
      collaborationLinkIds: [],
      userVisibleExplanation: input.message
    },
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: typeof inputTokens === "number" || typeof outputTokens === "number" ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined,
      model: input.model,
      vendor: input.vendor ?? "OpenClaw",
      estimatedCostUsd: input.estimatedCostUsd
    },
    privacy: {
      redactionApplied: true,
      sensitiveKinds: []
    },
    integrity: {}
  };
}

function normalizeCategory(category?: string, eventType?: string, status?: string): string {
  const normalized = category?.trim();
  const allowed = new Set([
    "coding",
    "research",
    "browsing",
    "planning",
    "writing",
    "design",
    "finance",
    "operations",
    "customer_support",
    "file_management",
    "memory_update",
    "tool_execution",
    "idle",
    "blocked",
    "error"
  ]);
  if (normalized && allowed.has(normalized)) return normalized;
  const joined = `${eventType ?? ""} ${status ?? ""}`.toLowerCase();
  if (joined.includes("tool")) return "tool_execution";
  if (joined.includes("memory")) return "memory_update";
  if (joined.includes("plan")) return "planning";
  if (joined.includes("block")) return "blocked";
  if (joined.includes("fail") || joined.includes("error")) return "error";
  return "operations";
}

function normalizeStatus(status?: string, eventType?: string): string {
  const joined = `${status ?? ""} ${eventType ?? ""}`.toLowerCase();
  if (joined.includes("fail") || joined.includes("error")) return "failed";
  if (joined.includes("block")) return "blocked";
  if (joined.includes("stop")) return "stopped";
  if (joined.includes("wait")) return "waiting";
  if (joined.includes("idle")) return "idle";
  return "active";
}

function normalizeRisk(severity?: string): string {
  const normalized = severity?.trim().toLowerCase();
  if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "low";
}

export default async function reportToTheia(context: HookContext): Promise<void> {
  const agentEndpoint = envOptional("THEIA_AGENT_TELEMETRY_ENDPOINT");
  const agentToken = envOptional("THEIA_AGENT_TOKEN");
  if (agentEndpoint && agentToken) {
    const agentId = envOptional("THEIA_AGENT_ID") ?? context.agentId ?? "agent:openclaw";
    const response = await fetch(agentEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${agentToken}`,
        "x-theia-agent-id": agentId,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(normalizeAgentActivity(context))
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Theia agent telemetry ingestion failed (${response.status}): ${text}`);
    }
    return;
  }

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
