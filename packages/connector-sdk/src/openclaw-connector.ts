import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Connector, ConnectorCapability, ConnectorHealth, ConnectorInitOptions } from "./types.js";
import type { EventType, WorkflowEvent } from "@theia/event-schema";
import { buildWorkflowEvent, safeEventType } from "./event-mapper.js";

interface OpenClawConnectorConfig {
  connectorId: string;
  logPaths: string[];
  defaultAgentId?: string;
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function inferOpenClawType(record: Record<string, unknown>, line: string): EventType | undefined {
  const explicitType = safeEventType(record.eventType ?? record.event_type ?? record.type ?? record.action_type);
  if (explicitType) return explicitType;

  const source = [
    readString(record, ["type", "event_type", "action_type", "step_type"]) ?? "",
    readString(record, ["status", "state", "result"]) ?? "",
    readString(record, ["message", "action", "observation"]) ?? "",
    line
  ]
    .join(" ")
    .toLowerCase();

  if (source.includes("tool") && source.includes("start")) return "tool_call.started";
  if (source.includes("tool") && (source.includes("complete") || source.includes("success") || source.includes("result"))) {
    return "tool_call.completed";
  }
  if (source.includes("tool") && (source.includes("error") || source.includes("fail"))) return "tool_call.failed";
  if (source.includes("memory") && (source.includes("read") || source.includes("retrieve"))) return "memory.read";
  if (source.includes("memory") && (source.includes("write") || source.includes("change") || source.includes("update"))) {
    return "memory.changed";
  }
  if (source.includes("checkpoint") || source.includes("plan")) return "checkpoint.created";
  if (source.includes("conclusion") || source.includes("final")) return "reasoning.conclusion";
  if (source.includes("reasoning") || source.includes("assumption")) return "reasoning.claim";
  if (source.includes("approval") && source.includes("grant")) return "approval.granted";
  if (source.includes("approval") && source.includes("deny")) return "approval.denied";
  if (source.includes("privileged") && source.includes("attempt")) return "privileged_action.attempted";
  if (source.includes("run") && source.includes("start")) return "run.started";
  if (source.includes("run") && (source.includes("complete") || source.includes("finished"))) return "run.completed";
  if (source.includes("run") && source.includes("fail")) return "run.failed";

  return undefined;
}

/**
 * OpenClawConnector ingests newline-delimited OpenClaw traces and maps them to Theia workflow events.
 * Supported records include OpenClaw-style keys such as:
 * - run_id/session_id/trajectory_id/trace_id
 * - agent_id/worker/planner
 * - event_type/type/action_type/status
 */
export class OpenClawConnector implements Connector {
  public readonly manifest;
  private options?: ConnectorInitOptions;
  private cursors = new Map<string, number>();
  private lastPoll?: Date;

  public constructor(private readonly config: OpenClawConnectorConfig) {
    const capabilities: ConnectorCapability[] = ["read_run_events", "read_tool_traces", "read_task_plans", "read_prompts"];
    this.manifest = {
      connectorId: config.connectorId,
      name: "OpenClaw Connector",
      version: "0.1.0",
      description: "Reads authorized OpenClaw agent traces and emits normalized Theia workflow events.",
      capabilities
    };
  }

  public async init(options: ConnectorInitOptions): Promise<void> {
    this.options = options;
    for (const configuredPath of this.config.logPaths) {
      this.cursors.set(path.resolve(configuredPath), 0);
    }
    this.options.context.emitAudit("connector.openclaw.init", {
      connectorId: this.manifest.connectorId,
      logPaths: this.config.logPaths
    });
  }

  public async poll(): Promise<WorkflowEvent[]> {
    if (!this.options) {
      throw new Error("Connector must be initialized before polling.");
    }

    const startedAt = Date.now();
    const events: WorkflowEvent[] = [];

    for (const configuredPath of this.config.logPaths) {
      const absolutePath = path.resolve(configuredPath);
      if (!this.isPathApproved(absolutePath)) {
        this.options.context.emitAudit("connector.openclaw.path_blocked", {
          connectorId: this.manifest.connectorId,
          attemptedPath: absolutePath
        });
        continue;
      }

      try {
        const content = await readFile(absolutePath, "utf8");
        const cursor = this.cursors.get(absolutePath) ?? 0;
        const newChunk = content.slice(cursor);
        if (!newChunk.trim()) {
          this.cursors.set(absolutePath, content.length);
          continue;
        }

        const newLines = newChunk
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        for (const line of newLines) {
          const parsed = this.parseLine(line);
          const mapped = parsed ? this.mapRecord(parsed, line) : undefined;
          const timestamp = readString(mapped ?? {}, ["timestamp"]) ?? this.options.context.now().toISOString();

          events.push(
            buildWorkflowEvent({
              connectorId: this.manifest.connectorId,
              workspaceId: this.options.scope.workspaceId,
              defaultAgentId: this.config.defaultAgentId ?? "agent:openclaw",
              defaultRunId: "run:openclaw",
              filePath: absolutePath,
              timestamp,
              lineContent: line,
              parsed: mapped
            })
          );
        }

        this.cursors.set(absolutePath, content.length);
      } catch (error) {
        events.push({
          eventId: `${this.manifest.connectorId}:error:${Date.now()}`,
          workspaceId: this.options.scope.workspaceId,
          agentId: this.config.defaultAgentId ?? "agent:openclaw",
          runId: "run:openclaw",
          eventType: "run.failed",
          timestamp: this.options.context.now().toISOString(),
          payload: {
            message: "OpenClaw connector failed to read trace file",
            filePath: absolutePath,
            error: (error as Error).message
          },
          source: {
            connectorId: this.manifest.connectorId,
            filePath: absolutePath
          },
          confidence: 0.9,
          evidenceRefs: []
        });
      }
    }

    this.lastPoll = new Date();
    this.options.context.emitAudit("connector.openclaw.poll", {
      connectorId: this.manifest.connectorId,
      emittedEvents: events.length,
      latencyMs: Date.now() - startedAt
    });

    return events;
  }

  public async health(): Promise<ConnectorHealth> {
    return {
      status: "healthy",
      lastSuccessfulPollAt: this.lastPoll?.toISOString(),
      latencyMs: 0
    };
  }

  public async shutdown(): Promise<void> {
    if (!this.options) return;
    this.options.context.emitAudit("connector.openclaw.shutdown", {
      connectorId: this.manifest.connectorId
    });
  }

  private parseLine(line: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  private mapRecord(record: Record<string, unknown>, line: string): Record<string, unknown> {
    const timestamp =
      readString(record, ["timestamp", "ts", "time", "created_at", "createdAt"]) ?? new Date().toISOString();
    const runId =
      readString(record, ["runId", "run_id", "session_id", "sessionId", "trajectory_id", "episode_id", "trace_id"]) ??
      "run:openclaw";
    const agentId = readString(record, ["agentId", "agent_id", "worker", "planner", "actor"]) ?? "agent:openclaw";
    const taskId = readString(record, ["taskId", "task_id", "step_id", "node_id"]);
    const confidence =
      readNumber(record, ["confidence", "confidence_score", "reasoning_confidence", "score"]) ?? 0.78;
    const eventType = inferOpenClawType(record, line);

    return {
      ...record,
      sourceSystem: "openclaw",
      timestamp,
      runId,
      agentId,
      taskId,
      confidence,
      eventType
    };
  }

  private isPathApproved(filePath: string): boolean {
    if (!this.options) return false;
    return this.options.scope.approvedPaths.some((approved) => {
      const absoluteApproved = path.resolve(approved);
      return filePath.startsWith(absoluteApproved);
    });
  }
}
