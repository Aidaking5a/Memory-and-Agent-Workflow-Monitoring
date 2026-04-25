import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Connector, ConnectorHealth, ConnectorInitOptions } from "./types.js";
import type { WorkflowEvent } from "@theia/event-schema";
import type { ConnectorCapability } from "./types.js";

interface LocalFileConnectorConfig {
  connectorId: string;
  name?: string;
  version?: string;
  files: string[];
}

/**
 * LocalFileConnector ingests approved markdown files and emits memory events.
 * It never traverses outside approved paths and only reads explicitly configured files.
 */
export class LocalFileConnector implements Connector {
  public readonly manifest;
  private options?: ConnectorInitOptions;
  private lastHashes = new Map<string, string>();
  private filePaths: string[];
  private lastPoll?: Date;

  public constructor(private readonly config: LocalFileConnectorConfig) {
    this.filePaths = config.files;
    const capabilities: ConnectorCapability[] = ["read_memory_files", "read_run_events"];
    this.manifest = {
      connectorId: config.connectorId,
      name: config.name ?? "Local File Connector",
      version: config.version ?? "0.1.0",
      description: "Reads authorized local files and emits Theia workflow events.",
      capabilities
    };
  }

  public async init(options: ConnectorInitOptions): Promise<void> {
    this.options = options;
    this.options.context.emitAudit("connector.initialized", {
      connectorId: this.manifest.connectorId,
      approvedPaths: options.scope.approvedPaths,
      files: this.filePaths
    });
  }

  public async poll(): Promise<WorkflowEvent[]> {
    if (!this.options) {
      throw new Error("Connector must be initialized before polling.");
    }

    const events: WorkflowEvent[] = [];
    const startedAt = Date.now();

    for (const configuredPath of this.filePaths) {
      const absolute = path.resolve(configuredPath);
      if (!this.isPathApproved(absolute)) {
        this.options.context.emitAudit("connector.path_blocked", {
          connectorId: this.manifest.connectorId,
          attemptedPath: absolute
        });
        continue;
      }

      try {
        const content = await readFile(absolute, "utf8");
        const hash = this.hash(content);
        const priorHash = this.lastHashes.get(absolute);
        if (priorHash === hash) {
          continue;
        }
        this.lastHashes.set(absolute, hash);

        const now = this.options.context.now().toISOString();
        events.push({
          eventId: `${this.manifest.connectorId}:${hash.slice(0, 16)}`,
          workspaceId: this.options.scope.workspaceId,
          agentId: "agent:external",
          runId: "run:file-ingestion",
          eventType: "memory.changed",
          timestamp: now,
          payload: {
            filePath: absolute,
            content,
            contentHash: hash,
            fileName: path.basename(absolute)
          },
          source: {
            connectorId: this.manifest.connectorId,
            filePath: absolute,
            contentHash: hash
          },
          confidence: 1,
          evidenceRefs: []
        });
      } catch (error) {
        events.push({
          eventId: `${this.manifest.connectorId}:error:${Date.now()}`,
          workspaceId: this.options.scope.workspaceId,
          agentId: "agent:external",
          runId: "run:file-ingestion",
          eventType: "run.failed",
          timestamp: this.options.context.now().toISOString(),
          payload: {
            message: "Connector failed to read file",
            filePath: absolute,
            error: (error as Error).message
          },
          source: {
            connectorId: this.manifest.connectorId,
            filePath: absolute
          },
          confidence: 0.95,
          evidenceRefs: []
        });
      }
    }

    this.lastPoll = new Date();
    const latencyMs = Date.now() - startedAt;
    this.options.context.emitAudit("connector.poll_completed", {
      connectorId: this.manifest.connectorId,
      emittedEvents: events.length,
      latencyMs
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
    if (!this.options) {
      return;
    }
    this.options.context.emitAudit("connector.shutdown", { connectorId: this.manifest.connectorId });
  }

  private isPathApproved(filePath: string): boolean {
    if (!this.options) {
      return false;
    }
    return this.options.scope.approvedPaths.some((approved) => {
      const absoluteApproved = path.resolve(approved);
      return filePath.startsWith(absoluteApproved);
    });
  }

  private hash(input: string): string {
    return createHash("sha256").update(input).digest("hex");
  }
}
