import { createHash } from "node:crypto";
import type { EventType, WorkflowEvent } from "@theia/event-schema";
import { eventTypeSchema } from "@theia/event-schema";

export interface BuildEventInput {
  connectorId: string;
  workspaceId: string;
  defaultAgentId: string;
  defaultRunId: string;
  filePath: string;
  timestamp: string;
  lineContent: string;
  parsed?: Record<string, unknown>;
}

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function inferType(text: string): EventType {
  const normalized = text.toLowerCase();

  if (normalized.includes("tool") && normalized.includes("fail")) return "tool_call.failed";
  if (normalized.includes("tool") && normalized.includes("complete")) return "tool_call.completed";
  if (normalized.includes("workflow") && normalized.includes("derived")) return "workflow.derived_decision";
  if (normalized.includes("workflow") && normalized.includes("candidate")) return "workflow.candidate_created";
  if (normalized.includes("workflow") && normalized.includes("promot")) return "workflow.promoted";
  if (normalized.includes("workflow") && normalized.includes("reject")) return "workflow.rejected";
  if (normalized.includes("workflow") && normalized.includes("rollback")) return "workflow.rollback";
  if (normalized.includes("workflow") && normalized.includes("conflict")) return "workflow.compatibility_conflict";
  if (normalized.includes("memory") && (normalized.includes("update") || normalized.includes("change"))) {
    return "memory.changed";
  }
  if (normalized.includes("assumption") || normalized.includes("hypothesis")) return "reasoning.claim";
  if (normalized.includes("conclusion") || normalized.includes("final answer")) return "reasoning.conclusion";
  if (normalized.includes("checkpoint") || normalized.includes("plan")) return "checkpoint.created";
  if (normalized.includes("approval") && normalized.includes("granted")) return "approval.granted";
  if (normalized.includes("approval") && normalized.includes("denied")) return "approval.denied";
  if (normalized.includes("privileged") && normalized.includes("attempt")) return "privileged_action.attempted";

  return "task.updated";
}

export function safeEventType(value: unknown): EventType | undefined {
  const result = eventTypeSchema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  return undefined;
}

export function buildWorkflowEvent(input: BuildEventInput): WorkflowEvent {
  const raw = input.parsed ?? {};
  const parsedEventType = safeEventType(raw.eventType);
  const fallbackType = inferType(input.lineContent);
  const eventType = parsedEventType ?? fallbackType;

  const eventIdSeed = [input.connectorId, input.filePath, input.timestamp, input.lineContent].join("|");
  const eventId = `${input.connectorId}:${hash(eventIdSeed).slice(0, 20)}`;

  const eventAgentId = typeof raw.agentId === "string" ? raw.agentId : input.defaultAgentId;
  const eventRunId = typeof raw.runId === "string" ? raw.runId : input.defaultRunId;
  const eventTaskId = typeof raw.taskId === "string" ? raw.taskId : undefined;

  const payload = {
    rawLine: input.lineContent,
    ...raw
  };

  const evidenceRefs: WorkflowEvent["evidenceRefs"] = [];
  if (typeof raw.evidenceEventId === "string") {
    evidenceRefs.push({ eventId: raw.evidenceEventId });
  }
  if (typeof raw.memoryVersionId === "string") {
    evidenceRefs.push({ memoryVersionId: raw.memoryVersionId });
  }

  return {
    eventId,
    workspaceId: input.workspaceId,
    agentId: eventAgentId,
    runId: eventRunId,
    taskId: eventTaskId,
    eventType,
    timestamp: input.timestamp,
    payload,
    source: {
      connectorId: input.connectorId,
      filePath: input.filePath,
      contentHash: hash(input.lineContent)
    },
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0.75,
    evidenceRefs
  };
}
