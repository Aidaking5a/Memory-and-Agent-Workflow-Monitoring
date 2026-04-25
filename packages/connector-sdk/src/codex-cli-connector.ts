import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Connector, ConnectorHealth, ConnectorInitOptions, ConnectorCapability } from "./types.js";
import type { WorkflowEvent } from "@theia/event-schema";
import { buildWorkflowEvent } from "./event-mapper.js";

interface CodexCliConnectorConfig {
  connectorId: string;
  logPaths: string[];
  agentId?: string;
}

/**
 * CodexCliConnector ingests newline-delimited Codex CLI logs (JSON lines or plain text).
 * It only reads explicitly configured files inside approved connector scope.
 */
export class CodexCliConnector implements Connector {
  public readonly manifest;
  private options?: ConnectorInitOptions;
  private cursors = new Map<string, number>();
  private lastPoll?: Date;

  public constructor(private readonly config: CodexCliConnectorConfig) {
    const capabilities: ConnectorCapability[] = ["read_run_events", "read_tool_traces", "read_task_plans"];
    this.manifest = {
      connectorId: config.connectorId,
      name: "Codex CLI Connector",
      version: "0.1.0",
      description: "Reads authorized Codex CLI logs and emits normalized workflow events.",
      capabilities
    };
  }

  public async init(options: ConnectorInitOptions): Promise<void> {
    this.options = options;
    for (const configuredPath of this.config.logPaths) {
      this.cursors.set(path.resolve(configuredPath), 0);
    }
    this.options.context.emitAudit("connector.codex.init", {
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
        this.options.context.emitAudit("connector.codex.path_blocked", {
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
          const rawTimestamp = typeof parsed?.timestamp === "string" ? parsed.timestamp : undefined;
          const timestamp = rawTimestamp ?? this.options.context.now().toISOString();

          events.push(
            buildWorkflowEvent({
              connectorId: this.manifest.connectorId,
              workspaceId: this.options.scope.workspaceId,
              defaultAgentId: this.config.agentId ?? "agent:codex-cli",
              defaultRunId: "run:codex-cli",
              filePath: absolutePath,
              timestamp,
              lineContent: line,
              parsed: parsed ?? undefined
            })
          );
        }

        this.cursors.set(absolutePath, content.length);
      } catch (error) {
        events.push({
          eventId: `${this.manifest.connectorId}:error:${Date.now()}`,
          workspaceId: this.options.scope.workspaceId,
          agentId: this.config.agentId ?? "agent:codex-cli",
          runId: "run:codex-cli",
          eventType: "run.failed",
          timestamp: this.options.context.now().toISOString(),
          payload: {
            message: "Codex connector failed to read log file",
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
    this.options.context.emitAudit("connector.codex.poll", {
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
    this.options.context.emitAudit("connector.codex.shutdown", {
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

  private isPathApproved(filePath: string): boolean {
    if (!this.options) return false;
    return this.options.scope.approvedPaths.some((approved) => {
      const absoluteApproved = path.resolve(approved);
      return filePath.startsWith(absoluteApproved);
    });
  }
}