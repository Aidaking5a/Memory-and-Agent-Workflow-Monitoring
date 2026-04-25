import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Connector, ConnectorHealth, ConnectorInitOptions, ConnectorCapability } from "./types.js";
import type { WorkflowEvent } from "@theia/event-schema";
import { buildWorkflowEvent } from "./event-mapper.js";

interface CustomJsonConnectorConfig {
  connectorId: string;
  jsonPaths: string[];
  defaultAgentId?: string;
}

/**
 * CustomJsonConnector ingests JSON files containing event arrays or envelope objects.
 * Supported formats:
 * - [ { timestamp, eventType, runId, taskId, payload, ... } ]
 * - { events: [ ... ] }
 */
export class CustomJsonConnector implements Connector {
  public readonly manifest;
  private options?: ConnectorInitOptions;
  private lastHashes = new Map<string, string>();
  private lastPoll?: Date;

  public constructor(private readonly config: CustomJsonConnectorConfig) {
    const capabilities: ConnectorCapability[] = ["read_run_events", "read_tool_traces", "read_task_plans"];
    this.manifest = {
      connectorId: config.connectorId,
      name: "Custom JSON Connector",
      version: "0.1.0",
      description: "Reads authorized custom JSON logs and emits normalized workflow events.",
      capabilities
    };
  }

  public async init(options: ConnectorInitOptions): Promise<void> {
    this.options = options;
    this.options.context.emitAudit("connector.custom-json.init", {
      connectorId: this.manifest.connectorId,
      jsonPaths: this.config.jsonPaths
    });
  }

  public async poll(): Promise<WorkflowEvent[]> {
    if (!this.options) {
      throw new Error("Connector must be initialized before polling.");
    }

    const startedAt = Date.now();
    const events: WorkflowEvent[] = [];

    for (const configuredPath of this.config.jsonPaths) {
      const absolutePath = path.resolve(configuredPath);
      if (!this.isPathApproved(absolutePath)) {
        this.options.context.emitAudit("connector.custom-json.path_blocked", {
          connectorId: this.manifest.connectorId,
          attemptedPath: absolutePath
        });
        continue;
      }

      try {
        const content = await readFile(absolutePath, "utf8");
        const contentHash = createHash("sha256").update(content).digest("hex");
        if (this.lastHashes.get(absolutePath) === contentHash) {
          continue;
        }

        const parsed = JSON.parse(content) as unknown;
        const records = this.normalizeRecords(parsed);

        for (const record of records) {
          const timestamp = typeof record.timestamp === "string" ? record.timestamp : this.options.context.now().toISOString();

          const lineContent = JSON.stringify(record);
          events.push(
            buildWorkflowEvent({
              connectorId: this.manifest.connectorId,
              workspaceId: this.options.scope.workspaceId,
              defaultAgentId: this.config.defaultAgentId ?? "agent:custom-json",
              defaultRunId: "run:custom-json",
              filePath: absolutePath,
              timestamp,
              lineContent,
              parsed: record
            })
          );
        }

        this.lastHashes.set(absolutePath, contentHash);
      } catch (error) {
        events.push({
          eventId: `${this.manifest.connectorId}:error:${Date.now()}`,
          workspaceId: this.options.scope.workspaceId,
          agentId: this.config.defaultAgentId ?? "agent:custom-json",
          runId: "run:custom-json",
          eventType: "run.failed",
          timestamp: this.options.context.now().toISOString(),
          payload: {
            message: "Custom JSON connector failed to parse file",
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
    this.options.context.emitAudit("connector.custom-json.poll", {
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
    this.options.context.emitAudit("connector.custom-json.shutdown", {
      connectorId: this.manifest.connectorId
    });
  }

  private normalizeRecords(parsed: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
    }

    if (parsed && typeof parsed === "object") {
      const candidate = parsed as Record<string, unknown>;
      if (Array.isArray(candidate.events)) {
        return candidate.events.filter(
          (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null
        );
      }
      return [candidate];
    }

    return [];
  }

  private isPathApproved(filePath: string): boolean {
    if (!this.options) return false;
    return this.options.scope.approvedPaths.some((approved) => {
      const absoluteApproved = path.resolve(approved);
      return filePath.startsWith(absoluteApproved);
    });
  }
}