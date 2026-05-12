import { createHash } from "node:crypto";
import type { AgentActivityEvent, AgentStatus } from "@theia/agent-protocol";
import type { WorkflowEvent } from "@theia/event-schema";

export interface OctopodaAgentRow {
  agent_id?: unknown;
  agentId?: unknown;
  name?: unknown;
  agent_type?: unknown;
  type?: unknown;
  state?: unknown;
  status?: unknown;
  performance_score?: unknown;
  total_operations?: unknown;
  total_writes?: unknown;
  total_reads?: unknown;
  total_queries?: unknown;
  memory_node_count?: unknown;
  uptime_seconds?: unknown;
  crash_count?: unknown;
  error_rate?: unknown;
  metadata?: unknown;
}

export interface MapOctopodaAgentInput {
  row: OctopodaAgentRow;
  workspaceId: string;
  connectorId: string;
  endpointLabel?: string;
  now?: Date;
  sequence?: number;
}

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeStatus(row: OctopodaAgentRow): AgentStatus {
  const value = (readString(row.status) ?? readString(row.state) ?? "").toLowerCase();
  if (value === "running" || value === "active") return "active";
  if (value === "blocked" || value === "waiting") return value;
  if (value === "failed" || value === "error" || value === "crashed") return "failed";
  if (value === "stopped" || value === "deregistered") return "stopped";
  return "idle";
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function mapOctopodaAgentToActivityEvent(input: MapOctopodaAgentInput): AgentActivityEvent {
  const timestamp = (input.now ?? new Date()).toISOString();
  const metadata = metadataObject(input.row.metadata);
  const rawAgentId = readString(input.row.agent_id) ?? readString(input.row.agentId) ?? readString(input.row.name) ?? "octopoda-agent";
  const agentId = rawAgentId.startsWith("agent:") ? rawAgentId : `agent:octopoda:${rawAgentId}`;
  const name = readString(input.row.name) ?? rawAgentId;
  const role = readString(input.row.agent_type) ?? readString(input.row.type) ?? "Octopoda Agent";
  const status = normalizeStatus(input.row);
  const operations = Math.max(0, Math.floor(readNumber(input.row.total_operations) ?? 0));
  const writes = Math.max(0, Math.floor(readNumber(input.row.total_writes) ?? 0));
  const reads = Math.max(0, Math.floor(readNumber(input.row.total_reads) ?? 0));
  const queries = Math.max(0, Math.floor(readNumber(input.row.total_queries) ?? 0));
  const memoryNodes = Math.max(0, Math.floor(readNumber(input.row.memory_node_count) ?? 0));
  const uptimeSeconds = Math.max(0, readNumber(input.row.uptime_seconds) ?? 0);
  const crashCount = Math.max(0, Math.floor(readNumber(input.row.crash_count) ?? 0));
  const errorRate = Math.max(0, readNumber(input.row.error_rate) ?? 0);
  const performanceScore = Math.max(0, Math.min(100, readNumber(input.row.performance_score) ?? 100));
  const riskLevel = crashCount > 0 || errorRate > 0.2 || performanceScore < 55 ? "medium" : "low";
  const category = memoryNodes > 0 || writes > 0 || reads > 0 ? "memory_update" : "operations";
  const eventId = `evt:octopoda:${hash([input.connectorId, agentId, timestamp, operations, memoryNodes].join("|"))}`;

  return {
    schemaVersion: "agent-activity/v1",
    eventId,
    timestamp,
    sequence: input.sequence,
    workspaceId: input.workspaceId,
    runId: `run:octopoda:${rawAgentId}`,
    agent: {
      agentId,
      name,
      role,
      domain: readString(metadata.domain) ?? "memory",
      model: readString(metadata.model),
      vendor: "Octopoda",
      connectionKind: "octopoda"
    },
    classification: {
      category,
      status,
      riskLevel,
      confidence: 0.86
    },
    what: {
      objective: "Persistent memory, loop detection, audit trail, and shared agent state.",
      currentTask: status === "active" ? "Maintaining persistent agent memory and operational telemetry." : "Standing by in Octopoda runtime.",
      safeSummary: `${name} reported ${operations} Octopoda operation(s), ${memoryNodes} memory node(s), and ${crashCount} crash marker(s).`,
      decisionTrace: [
        "Octopoda registry was read through a Theia connector.",
        "Theia converted runtime metrics into safe activity telemetry.",
        `Health score observed: ${performanceScore}/100.`
      ]
    },
    where: {
      targets: [
        {
          kind: "external_service",
          label: input.endpointLabel ?? "Octopoda runtime",
          redacted: false
        },
        {
          kind: "connector",
          label: input.connectorId,
          redacted: false
        }
      ]
    },
    how: {
      toolCalls: [
        {
          name: "octopoda_agent_stats",
          kind: "connector",
          status: "completed",
          safeSummary: "Read agent registry and summarized memory/runtime metrics."
        }
      ],
      filesAccessed: [],
      websitesVisited: [],
      apiCalls: ["/api/agents"],
      collaborationLinkIds: [],
      userVisibleExplanation: "Theia is observing Octopoda's public runtime metrics and converting them into command-center activity."
    },
    usage: {
      runtimeMs: Math.round(uptimeSeconds * 1000),
      model: readString(metadata.model),
      vendor: "Octopoda",
      paidServices: [],
      memoryFiles: [],
      logBytes: operations > 0 ? operations * 256 : undefined
    },
    privacy: {
      redactionApplied: true,
      sensitiveKinds: []
    },
    integrity: {
      keyId: input.connectorId
    }
  };
}

export function mapOctopodaActivityToWorkflowEvent(event: AgentActivityEvent, connectorId: string): WorkflowEvent {
  return {
    eventId: `octopoda:${event.eventId}`,
    workspaceId: event.workspaceId,
    agentId: event.agent.agentId,
    runId: event.runId ?? `run:${event.agent.agentId}`,
    taskId: event.taskId,
    eventType: event.classification.category === "memory_update" ? "memory.changed" : "task.updated",
    timestamp: event.timestamp,
    payload: {
      sourceSystem: "octopoda",
      category: event.classification.category,
      status: event.classification.status,
      riskLevel: event.classification.riskLevel,
      summary: event.what.safeSummary,
      decisionTrace: event.what.decisionTrace,
      runtimeMs: event.usage.runtimeMs,
      model: event.usage.model,
      vendor: event.usage.vendor
    },
    source: {
      connectorId,
      objectPath: event.where.targets[0]?.label ?? "octopoda"
    },
    confidence: event.classification.confidence,
    evidenceRefs: []
  };
}
