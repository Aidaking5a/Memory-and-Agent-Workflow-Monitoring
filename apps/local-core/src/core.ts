import type {
  MemoryObject,
  MemoryVersion,
  PermissionGrant,
  Run,
  RunSnapshot,
  Task,
  WorkflowEvent
} from "@theia/event-schema";
import {
  CodexCliConnector,
  CustomJsonConnector,
  LocalFileConnector,
  type Connector
} from "@theia/connector-sdk";
import { evaluateRun } from "@theia/reasoning-engine";
import { PolicyEngine, type AccessRequest } from "@theia/policy-engine";
import { parseMemoryFile } from "./parser.js";
import { buildTimeline } from "./timeline.js";
import path from "node:path";

interface TheiaCoreConfig {
  workspaceId: string;
  approvedPaths: string[];
  fileSources: string[];
  codexLogSources: string[];
  customJsonSources: string[];
}

export interface IngestionResult {
  events: WorkflowEvent[];
  memoryObjects: MemoryObject[];
  memoryVersions: MemoryVersion[];
}

export class TheiaCore {
  private connectors: Connector[] = [];
  private policy = new PolicyEngine();
  private events: WorkflowEvent[] = [];
  private runs: Run[] = [];
  private tasks: Task[] = [];
  private memoryObjects: MemoryObject[] = [];
  private memoryVersions: MemoryVersion[] = [];

  public constructor(private readonly config: TheiaCoreConfig) {}

  public async initialize(): Promise<void> {
    const localFileConnector = new LocalFileConnector({
      connectorId: "local-file-main",
      files: this.config.fileSources
    });

    await localFileConnector.init({
      scope: {
        workspaceId: this.config.workspaceId,
        approvedPaths: this.config.approvedPaths
      },
      context: {
        workspaceId: this.config.workspaceId,
        now: () => new Date(),
        emitEvent: (event) => this.events.push(event),
        emitAudit: (_message, _metadata) => undefined
      }
    });

    this.connectors.push(localFileConnector);

    if (this.config.codexLogSources.length > 0) {
      const codexConnector = new CodexCliConnector({
        connectorId: "codex-cli-main",
        logPaths: this.config.codexLogSources
      });

      await codexConnector.init({
        scope: {
          workspaceId: this.config.workspaceId,
          approvedPaths: this.config.approvedPaths
        },
        context: {
          workspaceId: this.config.workspaceId,
          now: () => new Date(),
          emitEvent: (event) => this.events.push(event),
          emitAudit: (_message, _metadata) => undefined
        }
      });

      this.connectors.push(codexConnector);
    }

    if (this.config.customJsonSources.length > 0) {
      const customJsonConnector = new CustomJsonConnector({
        connectorId: "custom-json-main",
        jsonPaths: this.config.customJsonSources
      });

      await customJsonConnector.init({
        scope: {
          workspaceId: this.config.workspaceId,
          approvedPaths: this.config.approvedPaths
        },
        context: {
          workspaceId: this.config.workspaceId,
          now: () => new Date(),
          emitEvent: (event) => this.events.push(event),
          emitAudit: (_message, _metadata) => undefined
        }
      });

      this.connectors.push(customJsonConnector);
    }
  }

  public addPermissionGrant(grant: PermissionGrant): void {
    this.policy.registerGrant(grant);
  }

  public authorize(request: AccessRequest): boolean {
    const decision = this.policy.evaluate(request);
    this.policy.appendAudit({
      auditId: `audit_${Date.now()}`,
      workspaceId: request.principal.workspaceId,
      actorId: request.principal.principalId,
      actorType: "user",
      action: `auth.${request.action}`,
      targetType: request.resourceType,
      targetId: request.resourceValue,
      timestamp: request.timestamp,
      metadata: {
        allowed: decision.allowed,
        reason: decision.reason,
        matchingGrantId: decision.matchingGrantId
      }
    });

    return decision.allowed;
  }

  public async ingestOnce(): Promise<IngestionResult> {
    const events: WorkflowEvent[] = [];

    for (const connector of this.connectors) {
      const emitted = await connector.poll();
      events.push(...emitted);
    }

    for (const event of events) {
      this.events.push(event);
      if (event.eventType !== "memory.changed") continue;

      const filePath =
        typeof event.payload.filePath === "string"
          ? event.payload.filePath
          : typeof event.source.filePath === "string"
            ? event.source.filePath
            : undefined;
      if (!filePath) continue;

      const parsed = await parseMemoryFile(filePath);
      for (const section of parsed.sections) {
        const memoryId = `memory_${path.basename(filePath)}_${section.sectionKey}`;
        const versionId = `version_${parsed.contentHash.slice(0, 16)}_${section.sectionKey}`;

        const memoryObject: MemoryObject = {
          memoryId,
          workspaceId: this.config.workspaceId,
          sourcePath: parsed.sourcePath,
          sourceType: parsed.sourceType,
          sectionKey: section.sectionKey,
          latestVersionId: versionId,
          tags: [parsed.sourceType]
        };

        const memoryVersion: MemoryVersion = {
          versionId,
          memoryId,
          createdAt: parsed.parsedAt,
          contentHash: parsed.contentHash,
          content: section.content,
          authorType: "connector",
          provenance: {
            connectorId: event.source.connectorId,
            filePath: parsed.sourcePath,
            contentHash: parsed.contentHash
          }
        };

        this.upsertMemory(memoryObject, memoryVersion);
      }
    }

    return {
      events,
      memoryObjects: [...this.memoryObjects],
      memoryVersions: [...this.memoryVersions]
    };
  }

  public createRun(objective: string, agentId: string): Run {
    const run: Run = {
      runId: `run_${Date.now()}`,
      workspaceId: this.config.workspaceId,
      agentId,
      objective,
      status: "running",
      startedAt: new Date().toISOString()
    };

    this.runs.push(run);
    return run;
  }

  public addTask(runId: string, title: string, ownerAgentId: string): Task {
    const task: Task = {
      taskId: `task_${Date.now()}`,
      runId,
      title,
      planOrder: this.tasks.filter((item) => item.runId === runId).length,
      state: "planned",
      ownerAgentId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.tasks.push(task);
    return task;
  }

  public addEvent(event: WorkflowEvent): void {
    this.events.push(event);
  }

  public getRunSnapshot(runId: string): RunSnapshot | undefined {
    const run = this.runs.find((item) => item.runId === runId);
    if (!run) return undefined;

    return {
      run,
      tasks: this.tasks.filter((task) => task.runId === runId),
      events: this.events.filter((event) => event.runId === runId),
      memoryVersions: [...this.memoryVersions]
    };
  }

  public evaluateRun(runId: string) {
    const snapshot = this.getRunSnapshot(runId);
    if (!snapshot) {
      throw new Error(`Run not found: ${runId}`);
    }

    return evaluateRun(snapshot);
  }

  public getTimeline(runId: string) {
    const snapshot = this.getRunSnapshot(runId);
    if (!snapshot) {
      throw new Error(`Run not found: ${runId}`);
    }
    return buildTimeline(runId, snapshot.events);
  }

  public listAudit() {
    return this.policy.getAuditTrail();
  }

  public listRuns(): Run[] {
    return [...this.runs];
  }

  public listTasks(runId?: string): Task[] {
    if (!runId) return [...this.tasks];
    return this.tasks.filter((task) => task.runId === runId);
  }

  public listEvents(runId?: string): WorkflowEvent[] {
    if (!runId) return [...this.events];
    return this.events.filter((event) => event.runId === runId);
  }

  public listMemory() {
    return {
      objects: [...this.memoryObjects],
      versions: [...this.memoryVersions]
    };
  }

  public async listConnectorHealth() {
    const result = await Promise.all(
      this.connectors.map(async (connector) => ({
        connectorId: connector.manifest.connectorId,
        name: connector.manifest.name,
        health: await connector.health()
      }))
    );
    return result;
  }

  private upsertMemory(memoryObject: MemoryObject, memoryVersion: MemoryVersion): void {
    const existingObjectIndex = this.memoryObjects.findIndex((obj) => obj.memoryId === memoryObject.memoryId);
    if (existingObjectIndex >= 0) {
      this.memoryObjects[existingObjectIndex] = memoryObject;
    } else {
      this.memoryObjects.push(memoryObject);
    }

    const existingVersionIndex = this.memoryVersions.findIndex((version) => version.versionId === memoryVersion.versionId);
    if (existingVersionIndex >= 0) {
      this.memoryVersions[existingVersionIndex] = memoryVersion;
    } else {
      this.memoryVersions.push(memoryVersion);
    }
  }
}
