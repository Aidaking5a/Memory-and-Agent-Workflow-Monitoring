import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Connector, ConnectorCapability, ConnectorHealth, ConnectorInitOptions } from "./types.js";
import type { EventType, WorkflowEvent } from "@theia/event-schema";
import { buildWorkflowEvent, safeEventType } from "./event-mapper.js";

interface OpenClawConnectorConfig {
  connectorId: string;
  logPaths: string[];
  defaultAgentId?: string;
}

interface SourceIssue {
  firstDetectedAt: string;
  lastDetectedAt: string;
  count: number;
  lastError: string;
  lastAuditAt?: number;
}

const SOURCE_MISSING_AUDIT_INTERVAL_MS = 5 * 60 * 1000;
const MAX_DIRECTORY_FILES = 16;
const LOG_EXTENSIONS = new Set([".jsonl", ".log", ".txt", ".ndjson"]);

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
  private partialLines = new Map<string, string>();
  private sourceIssues = new Map<string, SourceIssue>();
  private lastPoll?: Date;
  private lastSuccessfulPoll?: Date;
  private lastLatencyMs = 0;
  private lastHardError?: string;

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
    let readSuccessCount = 0;

    for (const configuredPath of this.config.logPaths) {
      const absolutePath = path.resolve(configuredPath);
      if (!this.isPathApproved(absolutePath)) {
        this.options.context.emitAudit("connector.openclaw.path_blocked", {
          connectorId: this.manifest.connectorId,
          attemptedPath: absolutePath
        });
        continue;
      }

      const sourceFiles = await this.resolveSourceFiles(absolutePath);
      if (sourceFiles.length === 0) {
        continue;
      }

      for (const sourceFile of sourceFiles) {
        if (!this.isPathApproved(sourceFile)) {
          this.options.context.emitAudit("connector.openclaw.path_blocked", {
            connectorId: this.manifest.connectorId,
            attemptedPath: sourceFile
          });
          continue;
        }

        const readResult = await this.readSourceFileChunk(sourceFile);
        if (readResult.kind === "missing") {
          this.markSourceIssue(sourceFile, readResult.errorMessage);
          continue;
        }
        if (readResult.kind === "error") {
          this.lastHardError = readResult.errorMessage;
          this.markSourceIssue(sourceFile, readResult.errorMessage);
          this.options.context.emitAudit("connector.openclaw.read_error", {
            connectorId: this.manifest.connectorId,
            sourceFile,
            error: readResult.errorMessage
          });
          continue;
        }

        this.clearSourceIssue(sourceFile);
        readSuccessCount += 1;

        if (readResult.lines.length === 0) {
          continue;
        }

        for (const line of readResult.lines) {
          const parsed = this.parseLine(line);
          const mapped = parsed ? this.mapRecord(parsed, line) : undefined;
          const timestamp = readString(mapped ?? {}, ["timestamp"]) ?? this.options.context.now().toISOString();

          events.push(
            buildWorkflowEvent({
              connectorId: this.manifest.connectorId,
              workspaceId: this.options.scope.workspaceId,
              defaultAgentId: this.config.defaultAgentId ?? "agent:openclaw",
              defaultRunId: "run:openclaw",
              filePath: sourceFile,
              timestamp,
              lineContent: line,
              parsed: mapped
            })
          );
        }
      }
    }

    this.lastLatencyMs = Date.now() - startedAt;
    this.lastPoll = new Date();
    if (readSuccessCount > 0) {
      this.lastSuccessfulPoll = this.lastPoll;
      this.lastHardError = undefined;
    }
    this.options.context.emitAudit("connector.openclaw.poll", {
      connectorId: this.manifest.connectorId,
      emittedEvents: events.length,
      latencyMs: this.lastLatencyMs,
      readSuccessCount,
      missingSources: this.sourceIssues.size
    });

    return events;
  }

  public async health(): Promise<ConnectorHealth> {
    if (!this.lastPoll) {
      return {
        status: "offline",
        message: "Waiting for first connector poll."
      };
    }

    const missingCount = this.sourceIssues.size;
    if (missingCount > 0) {
      const suffix =
        missingCount === 1
          ? "1 configured source is missing or stale (suppressed from run.failed noise)."
          : `${missingCount} configured sources are missing or stale (suppressed from run.failed noise).`;
      return {
        status: this.lastSuccessfulPoll ? "degraded" : "offline",
        lastSuccessfulPollAt: this.lastSuccessfulPoll?.toISOString(),
        latencyMs: this.lastLatencyMs,
        message: suffix
      };
    }

    if (this.lastHardError) {
      return {
        status: "degraded",
        lastSuccessfulPollAt: this.lastSuccessfulPoll?.toISOString(),
        latencyMs: this.lastLatencyMs,
        message: this.lastHardError
      };
    }

    return {
      status: "healthy",
      lastSuccessfulPollAt: this.lastSuccessfulPoll?.toISOString() ?? this.lastPoll.toISOString(),
      latencyMs: this.lastLatencyMs
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

  private async resolveSourceFiles(configuredPath: string): Promise<string[]> {
    try {
      const details = await stat(configuredPath);
      if (details.isDirectory()) {
        const entries = await readdir(configuredPath, { withFileTypes: true });
        const candidates = entries
          .filter((entry) => entry.isFile())
          .map((entry) => path.join(configuredPath, entry.name))
          .filter((entryPath) => LOG_EXTENSIONS.has(path.extname(entryPath).toLowerCase()));

        if (candidates.length === 0) {
          this.markSourceIssue(configuredPath, "No readable transcript files were found in this directory.");
          return [];
        }

        const stamped = await Promise.all(
          candidates.map(async (entryPath) => {
            try {
              const fileDetails = await stat(entryPath);
              return { entryPath, mtimeMs: fileDetails.mtimeMs };
            } catch {
              return { entryPath, mtimeMs: 0 };
            }
          })
        );

        const resolved = stamped
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
          .slice(0, MAX_DIRECTORY_FILES)
          .map((item) => item.entryPath);

        this.clearSourceIssue(configuredPath);
        return resolved;
      }

      if (!details.isFile()) {
        this.markSourceIssue(configuredPath, "Configured source is not a file.");
        return [];
      }

      this.clearSourceIssue(configuredPath);
      return [configuredPath];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unable to resolve configured source.";
      this.markSourceIssue(configuredPath, errorMessage);
      return [];
    }
  }

  private async readSourceFileChunk(sourceFile: string): Promise<
    | { kind: "ok"; lines: string[] }
    | { kind: "missing"; errorMessage: string }
    | { kind: "error"; errorMessage: string }
  > {
    try {
      const content = await readFile(sourceFile, "utf8");
      const existingCursor = this.cursors.get(sourceFile) ?? 0;
      const cursor = existingCursor > content.length ? 0 : existingCursor;
      const carry = this.partialLines.get(sourceFile) ?? "";
      const newChunk = `${carry}${content.slice(cursor)}`;

      if (!newChunk) {
        this.cursors.set(sourceFile, content.length);
        return { kind: "ok", lines: [] };
      }

      const rawLines = newChunk.split(/\r?\n/);
      const trailing = rawLines.pop() ?? "";
      let trailingCarry = trailing;
      this.cursors.set(sourceFile, content.length);

      const lines = rawLines.map((line) => line.trim()).filter(Boolean);
      const trimmedTrailing = trailing.trim();
      if (trimmedTrailing.length > 0) {
        try {
          JSON.parse(trimmedTrailing);
          lines.push(trimmedTrailing);
          trailingCarry = "";
        } catch {
          // Keep carrying non-JSON trailing fragments until newline arrives.
        }
      }
      this.partialLines.set(sourceFile, trailingCarry);
      return { kind: "ok", lines };
    } catch (error) {
      const code = this.errorCode(error);
      const message = error instanceof Error ? error.message : "Unknown read error.";
      if (["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EBUSY"].includes(code ?? "")) {
        return { kind: "missing", errorMessage: message };
      }
      return { kind: "error", errorMessage: message };
    }
  }

  private markSourceIssue(sourcePath: string, errorMessage: string): void {
    if (!this.options) return;

    const now = Date.now();
    const nowIso = this.options.context.now().toISOString();
    const existing = this.sourceIssues.get(sourcePath);
    const issue: SourceIssue = existing
      ? {
          ...existing,
          count: existing.count + 1,
          lastDetectedAt: nowIso,
          lastError: errorMessage
        }
      : {
          firstDetectedAt: nowIso,
          lastDetectedAt: nowIso,
          count: 1,
          lastError: errorMessage
        };
    this.sourceIssues.set(sourcePath, issue);

    const shouldAudit = !issue.lastAuditAt || now - issue.lastAuditAt >= SOURCE_MISSING_AUDIT_INTERVAL_MS;
    if (shouldAudit) {
      issue.lastAuditAt = now;
      this.sourceIssues.set(sourcePath, issue);
      this.options.context.emitAudit("connector.openclaw.source_missing", {
        connectorId: this.manifest.connectorId,
        sourcePath,
        count: issue.count,
        firstDetectedAt: issue.firstDetectedAt,
        lastDetectedAt: issue.lastDetectedAt,
        error: issue.lastError
      });
    }
  }

  private clearSourceIssue(sourcePath: string): void {
    if (!this.options) return;
    const issue = this.sourceIssues.get(sourcePath);
    if (!issue) return;
    this.sourceIssues.delete(sourcePath);
    this.options.context.emitAudit("connector.openclaw.source_recovered", {
      connectorId: this.manifest.connectorId,
      sourcePath,
      firstDetectedAt: issue.firstDetectedAt,
      recoveredAt: this.options.context.now().toISOString(),
      failureCount: issue.count
    });
  }

  private errorCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object") return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
}
