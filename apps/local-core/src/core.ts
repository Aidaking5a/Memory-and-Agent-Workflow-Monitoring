import type {
  MemoryObject,
  MemoryVersion,
  PermissionGrant,
  Run,
  RunSnapshot,
  Severity,
  Task,
  WorkflowCandidate,
  WorkflowEvidencePacket,
  WorkflowEvent,
  WorkflowGateMetrics,
  WorkflowNamespace,
  WorkflowPromotionDecision,
  WorkflowPromotionPolicy,
  WorkflowReleaseGateReport
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
import { createHash } from "node:crypto";

const DEFAULT_WORKFLOW_POLICY: WorkflowPromotionPolicy = {
  minConfidenceScore: 0.78,
  minEvaluatorAgreement: 0.7,
  minToolGroundingScore: 0.72,
  minUtilityRate: 0.62,
  maxOverlapRate: 0.88,
  maxContradictionRate: 0.12,
  maxStaleUseRate: 0.18,
  minEvidencePacketCount: 2,
  minSafeAutomationEvidenceCount: 0,
  requireHumanApprovalForHighImpact: true
};

interface TheiaCoreConfig {
  workspaceId: string;
  approvedPaths: string[];
  fileSources: string[];
  codexLogSources: string[];
  customJsonSources: string[];
  workflowPolicy?: Partial<WorkflowPromotionPolicy>;
  defaultTenantId?: string;
  now?: () => Date;
}

export interface IngestionResult {
  events: WorkflowEvent[];
  memoryObjects: MemoryObject[];
  memoryVersions: MemoryVersion[];
}

export interface DeriveWorkflowOptions {
  promoteIfEligible?: boolean;
  forceHumanReview?: boolean;
  actorId?: string;
}

export interface WorkflowReviewInput {
  approved: boolean;
  actorId: string;
  reason?: string;
  humanApprovalProvided?: boolean;
}

export interface WorkflowDeriveResult {
  candidate: WorkflowCandidate;
  gateFailures: string[];
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenSet(input: string): Set<string> {
  return new Set(
    normalizeText(input)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter((value) => b.has(value)));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

function clampScore(input: number, fallback = 0): number {
  if (!Number.isFinite(input)) return fallback;
  return Math.max(0, Math.min(1, input));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function domainFromUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function taskFamilyFromObjective(objective: string): string {
  const text = normalizeText(objective);
  if (/\b(login|auth|saml|sso|identity)\b/.test(text)) return "identity";
  if (/\bcheckout|order|payment|stripe|billing\b/.test(text)) return "commerce";
  if (/\bdeploy|release|ci|cd|build\b/.test(text)) return "delivery";
  if (/\bobserve|alert|monitor|audit\b/.test(text)) return "observability";
  if (/\banalyze|research|report|insight\b/.test(text)) return "analysis";
  return "general";
}

function severityRank(value: Severity): number {
  switch (value) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    case "info":
      return 1;
    default:
      return 0;
  }
}

export class TheiaCore {
  private connectors: Connector[] = [];
  private policy = new PolicyEngine();
  private events: WorkflowEvent[] = [];
  private runs: Run[] = [];
  private tasks: Task[] = [];
  private memoryObjects: MemoryObject[] = [];
  private memoryVersions: MemoryVersion[] = [];
  private workflowCandidates: WorkflowCandidate[] = [];
  private workflowDecisions: WorkflowPromotionDecision[] = [];
  private workflowPolicy: WorkflowPromotionPolicy;
  private idCounter = 0;

  public constructor(private readonly config: TheiaCoreConfig) {
    this.workflowPolicy = {
      ...DEFAULT_WORKFLOW_POLICY,
      ...(config.workflowPolicy ?? {})
    };
  }

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
        now: () => this.now(),
        emitEvent: (event) => this.events.push(event),
        emitAudit: (message, metadata) => this.appendConnectorAudit(message, metadata)
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
          now: () => this.now(),
          emitEvent: (event) => this.events.push(event),
          emitAudit: (message, metadata) => this.appendConnectorAudit(message, metadata)
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
          now: () => this.now(),
          emitEvent: (event) => this.events.push(event),
          emitAudit: (message, metadata) => this.appendConnectorAudit(message, metadata)
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
      auditId: this.nextId("audit"),
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

  public createRun(objective: string, agentId: string, metadata?: Record<string, unknown>): Run {
    const run: Run = {
      runId: this.nextId("run"),
      workspaceId: this.config.workspaceId,
      agentId,
      objective,
      status: "running",
      startedAt: this.nowIso(),
      metadata
    };

    this.runs.push(run);
    this.events.push(this.createTheiaEvent(run.runId, run.agentId, "run.started", { objective, metadata: metadata ?? {} }, 1));
    return run;
  }

  public updateRunStatus(runId: string, status: Run["status"]): Run {
    const run = this.runs.find((item) => item.runId === runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const updated: Run = {
      ...run,
      status,
      endedAt: status === "running" ? undefined : this.nowIso()
    };
    this.runs = this.runs.map((item) => (item.runId === runId ? updated : item));

    this.events.push(
      this.createTheiaEvent(
        runId,
        updated.agentId,
        status === "completed" ? "run.completed" : status === "running" ? "run.started" : "run.failed",
        { status },
        0.98
      )
    );

    return updated;
  }

  public addTask(runId: string, title: string, ownerAgentId: string): Task {
    const now = this.nowIso();
    const task: Task = {
      taskId: this.nextId("task"),
      runId,
      title,
      planOrder: this.tasks.filter((item) => item.runId === runId).length,
      state: "planned",
      ownerAgentId,
      createdAt: now,
      updatedAt: now
    };
    this.tasks.push(task);
    this.events.push(
      this.createTheiaEvent(runId, ownerAgentId, "task.created", { taskId: task.taskId, title: task.title, state: task.state }, 0.98)
    );
    return task;
  }

  public addEvent(event: WorkflowEvent): void {
    this.events.push(event);
    if (event.eventType !== "workflow.derived_decision") return;
    const workflowId = readString(event.payload.workflowId);
    if (!workflowId) return;
    const candidate = this.workflowCandidates.find((item) => item.workflowId === workflowId);
    if (!candidate) return;
    candidate.lastUsedAt = this.nowIso();
    candidate.updatedAt = candidate.lastUsedAt;
  }

  public getRunSnapshot(runId: string): RunSnapshot | undefined {
    const run = this.runs.find((item) => item.runId === runId);
    if (!run) return undefined;

    return {
      run,
      tasks: this.tasks.filter((task) => task.runId === runId),
      events: this.events.filter((event) => event.runId === runId),
      memoryVersions: [...this.memoryVersions],
      workflowCandidates: this.workflowCandidates.filter((candidate) => candidate.sourceRunId === runId)
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

  public deriveWorkflowCandidate(runId: string, options: DeriveWorkflowOptions = {}): WorkflowDeriveResult {
    const snapshot = this.getRunSnapshot(runId);
    if (!snapshot) {
      throw new Error(`Run not found: ${runId}`);
    }

    const namespace = this.resolveNamespace(snapshot.run, snapshot.events);
    const gateMetrics = this.computeGateMetrics(snapshot);
    const compatibility = this.evaluateCompatibility(namespace, snapshot.run.objective);
    gateMetrics.overlapRate = compatibility.overlapRate;

    const now = this.nowIso();
    const candidate: WorkflowCandidate = {
      workflowId: this.nextId("wf"),
      workspaceId: this.config.workspaceId,
      sourceRunId: runId,
      title: this.buildWorkflowTitle(snapshot.run.objective, namespace),
      summary: this.buildWorkflowSummary(snapshot),
      status: "candidate",
      impactLevel: this.estimateImpact(snapshot),
      namespace,
      gateMetrics,
      policyAtDecisionTime: { ...this.workflowPolicy },
      evidencePacket: this.buildEvidencePacket(snapshot),
      compatibilityNotes: [...compatibility.notes],
      conflictWithWorkflowIds: [...compatibility.conflictWithWorkflowIds],
      provenance: {
        derivedFromRunId: runId,
        sourceEventIds: snapshot.events.map((event) => event.eventId).slice(0, 50),
        objectiveSnapshot: snapshot.run.objective,
        objectiveHash: this.hash(snapshot.run.objective)
      },
      createdAt: now,
      updatedAt: now
    };

    this.workflowCandidates.push(candidate);
    this.events.push(
      this.createTheiaEvent(
        runId,
        snapshot.run.agentId,
        "workflow.candidate_created",
        {
          workflowId: candidate.workflowId,
          title: candidate.title,
          signalQuality: candidate.gateMetrics.confidenceScore,
          sampleRuns: 1,
          namespace: candidate.namespace
        },
        candidate.gateMetrics.confidenceScore,
        undefined,
        candidate.evidencePacket.refs
      )
    );

    this.events.push(
      this.createTheiaEvent(
        runId,
        snapshot.run.agentId,
        "workflow.derived_decision",
        {
          workflowId: candidate.workflowId,
          workflowTitle: candidate.title,
          workflowObjective: candidate.provenance.objectiveSnapshot,
          contextShiftScore: 1 - Math.max(candidate.gateMetrics.utilityRate, 0.2),
          domainChanged: candidate.namespace.domain !== "general"
        },
        candidate.gateMetrics.confidenceScore,
        undefined,
        candidate.evidencePacket.refs
      )
    );

    if (candidate.conflictWithWorkflowIds.length > 0) {
      this.events.push(
        this.createTheiaEvent(
          runId,
          snapshot.run.agentId,
          "workflow.compatibility_conflict",
          {
            workflowId: candidate.workflowId,
            conflictWithWorkflowIds: candidate.conflictWithWorkflowIds,
            notes: candidate.compatibilityNotes
          },
          0.9,
          undefined,
          candidate.evidencePacket.refs
        )
      );
    }

    const gateFailures = this.evaluatePromotionGates(candidate);
    if (gateFailures.length > 0) {
      candidate.status = "rejected";
      candidate.updatedAt = this.nowIso();
      this.events.push(
        this.createTheiaEvent(
          runId,
          snapshot.run.agentId,
          "workflow.rejected",
          {
            workflowId: candidate.workflowId,
            gateFailures
          },
          0.93,
          undefined,
          candidate.evidencePacket.refs
        )
      );
      this.appendSystemAudit("workflow.rejected", options.actorId ?? "system:theia", candidate.workflowId, {
        gateFailures
      });
      return { candidate, gateFailures };
    }

    const requiresHumanReview = options.forceHumanReview ?? this.requiresHumanApproval(candidate, candidate.policyAtDecisionTime);
    if ((options.promoteIfEligible ?? true) && !requiresHumanReview) {
      candidate.status = "promoted";
      candidate.promotedAt = this.nowIso();
      candidate.updatedAt = candidate.promotedAt;
      this.events.push(
        this.createTheiaEvent(
          runId,
          snapshot.run.agentId,
          "workflow.promoted",
          {
            workflowId: candidate.workflowId,
            promotedBy: options.actorId ?? "system:theia",
            namespace: candidate.namespace
          },
          Math.max(0.86, candidate.gateMetrics.confidenceScore),
          undefined,
          candidate.evidencePacket.refs
        )
      );
      this.appendSystemAudit("workflow.promoted", options.actorId ?? "system:theia", candidate.workflowId, {
        namespace: candidate.namespace
      });
      return { candidate, gateFailures: [] };
    }

    candidate.status = "pending_review";
    candidate.updatedAt = this.nowIso();
    this.events.push(
      this.createTheiaEvent(
        runId,
        snapshot.run.agentId,
        "workflow.promotion_requested",
        {
          workflowId: candidate.workflowId,
          requestedBy: options.actorId ?? "system:theia",
          requiresHumanReview
        },
        0.87,
        undefined,
        candidate.evidencePacket.refs
      )
    );
    this.appendSystemAudit("workflow.promotion_requested", options.actorId ?? "system:theia", candidate.workflowId, {
      impactLevel: candidate.impactLevel
    });
    return { candidate, gateFailures: [] };
  }

  public reviewWorkflowCandidate(workflowId: string, input: WorkflowReviewInput) {
    const candidate = this.workflowCandidates.find((item) => item.workflowId === workflowId);
    if (!candidate) {
      throw new Error(`Workflow candidate not found: ${workflowId}`);
    }
    if (candidate.status === "retired" || candidate.status === "expired" || candidate.status === "rolled_back") {
      throw new Error(`Workflow ${workflowId} cannot be reviewed from status ${candidate.status}`);
    }

    const gateFailures = this.evaluatePromotionGates(candidate);
    const reasons: string[] = [];
    if (input.reason) {
      reasons.push(input.reason);
    }

    let approved = input.approved;
    if (approved && gateFailures.length > 0) {
      approved = false;
      reasons.push(...gateFailures);
    }
    if (
      approved &&
      this.requiresHumanApproval(candidate, candidate.policyAtDecisionTime) &&
      input.humanApprovalProvided === false
    ) {
      approved = false;
      reasons.push("Human approval required for high-impact workflow promotion.");
    }

    const requestedAt = this.getPromotionRequestedAt(workflowId) ?? candidate.createdAt;
    const decidedAt = this.nowIso();
    const decision: WorkflowPromotionDecision = {
      workflowId,
      workspaceId: this.config.workspaceId,
      approved,
      requestedAt,
      decidedAt,
      decidedBy: input.actorId,
      humanApprovalProvided: input.humanApprovalProvided ?? true,
      reasons
    };
    this.workflowDecisions.push(decision);

    candidate.status = approved ? "promoted" : "rejected";
    candidate.updatedAt = decidedAt;
    if (approved) {
      candidate.promotedAt = decidedAt;
    }

    this.events.push(
      this.createTheiaEvent(
        candidate.sourceRunId,
        input.actorId,
        approved ? "workflow.promoted" : "workflow.rejected",
        {
          workflowId,
          reasons,
          gateFailures: approved ? [] : gateFailures,
          decidedBy: input.actorId
        },
        approved ? 0.96 : 0.92,
        undefined,
        candidate.evidencePacket.refs
      )
    );
    this.appendSystemAudit("workflow.review", input.actorId, workflowId, {
      approved,
      reasons
    });

    return { candidate, decision, gateFailures };
  }

  public rollbackWorkflow(workflowId: string, actorId: string, reason: string): WorkflowCandidate {
    const candidate = this.workflowCandidates.find((item) => item.workflowId === workflowId);
    if (!candidate) {
      throw new Error(`Workflow candidate not found: ${workflowId}`);
    }
    if (candidate.status !== "promoted") {
      throw new Error(`Only promoted workflows can be rolled back. Current status: ${candidate.status}`);
    }

    const now = this.nowIso();
    candidate.status = "rolled_back";
    candidate.rolledBackAt = now;
    candidate.updatedAt = now;
    candidate.retiredReason = reason;

    this.events.push(
      this.createTheiaEvent(
        candidate.sourceRunId,
        actorId,
        "workflow.rollback",
        {
          workflowId,
          reason
        },
        0.95,
        undefined,
        candidate.evidencePacket.refs
      )
    );
    this.appendSystemAudit("workflow.rollback", actorId, workflowId, { reason });
    return candidate;
  }

  public retireStaleWorkflows(maxAgeDays = 30, actorId = "system:theia"): WorkflowCandidate[] {
    const cutoffTs = this.now().getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
    const retired: WorkflowCandidate[] = [];

    for (const candidate of this.workflowCandidates) {
      if (!["candidate", "pending_review", "promoted"].includes(candidate.status)) continue;
      const reference = candidate.lastUsedAt ?? candidate.promotedAt ?? candidate.updatedAt ?? candidate.createdAt;
      const referenceTs = new Date(reference).getTime();
      if (!Number.isFinite(referenceTs) || referenceTs >= cutoffTs) continue;

      const now = this.nowIso();
      candidate.status = "retired";
      candidate.retiredAt = now;
      candidate.updatedAt = now;
      candidate.retiredReason = `No usage in ${maxAgeDays} days`;
      retired.push(candidate);

      this.events.push(
        this.createTheiaEvent(candidate.sourceRunId, actorId, "workflow.expired", {
          workflowId: candidate.workflowId,
          maxAgeDays
        })
      );
      this.events.push(
        this.createTheiaEvent(candidate.sourceRunId, actorId, "workflow.retired", {
          workflowId: candidate.workflowId,
          reason: candidate.retiredReason
        })
      );
      this.appendSystemAudit("workflow.retired", actorId, candidate.workflowId, {
        maxAgeDays
      });
    }

    return retired;
  }

  public listWorkflowCandidates(): WorkflowCandidate[] {
    return [...this.workflowCandidates].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  public getWorkflowCandidate(workflowId: string): WorkflowCandidate | undefined {
    return this.workflowCandidates.find((candidate) => candidate.workflowId === workflowId);
  }

  public listWorkflowPromotionQueue(): WorkflowCandidate[] {
    return this.workflowCandidates.filter((candidate) => candidate.status === "pending_review");
  }

  public listWorkflowDecisions(): WorkflowPromotionDecision[] {
    return [...this.workflowDecisions];
  }

  public getWorkflowPromotionPolicy(): WorkflowPromotionPolicy {
    return { ...this.workflowPolicy };
  }

  public updateWorkflowPromotionPolicy(update: Partial<WorkflowPromotionPolicy>, actorId: string): WorkflowPromotionPolicy {
    this.workflowPolicy = {
      ...this.workflowPolicy,
      ...update
    };
    this.appendSystemAudit("workflow.policy.updated", actorId, this.config.workspaceId, { update });
    return { ...this.workflowPolicy };
  }

  public getWorkflowReleaseGateReport(): WorkflowReleaseGateReport {
    const all = this.workflowCandidates;
    const promoted = all.filter((candidate) => candidate.status === "promoted").length;
    const pendingReview = all.filter((candidate) => candidate.status === "pending_review").length;
    const rejected = all.filter((candidate) => candidate.status === "rejected").length;
    const rolledBack = all.filter((candidate) => candidate.status === "rolled_back").length;
    const conflictOpenCount = all.filter(
      (candidate) =>
        candidate.conflictWithWorkflowIds.length > 0 &&
        candidate.status !== "retired" &&
        candidate.status !== "rolled_back"
    ).length;

    return {
      workspaceId: this.config.workspaceId,
      generatedAt: this.nowIso(),
      totalCandidates: all.length,
      promotedCandidates: promoted,
      pendingReviewCandidates: pendingReview,
      rejectedCandidates: rejected,
      rolledBackCandidates: rolledBack,
      conflictOpenCount,
      avgConfidenceScore: clampScore(average(all.map((candidate) => candidate.gateMetrics.confidenceScore))),
      avgUtilityRate: clampScore(average(all.map((candidate) => candidate.gateMetrics.utilityRate))),
      avgContradictionRate: clampScore(average(all.map((candidate) => candidate.gateMetrics.contradictionRate))),
      avgStaleUseRate: clampScore(average(all.map((candidate) => candidate.gateMetrics.staleUseRate)))
    };
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

  private now(): Date {
    return this.config.now ? this.config.now() : new Date();
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_${Date.now()}_${this.idCounter}`;
  }

  private hash(input: string): string {
    return createHash("sha256").update(input).digest("hex");
  }

  private createTheiaEvent(
    runId: string,
    agentId: string,
    eventType: WorkflowEvent["eventType"],
    payload: Record<string, unknown>,
    confidence?: number,
    taskId?: string,
    evidenceRefs?: WorkflowEvent["evidenceRefs"]
  ): WorkflowEvent {
    return {
      eventId: this.nextId("evt"),
      workspaceId: this.config.workspaceId,
      agentId,
      runId,
      taskId,
      eventType,
      timestamp: this.nowIso(),
      payload,
      source: {
        connectorId: "theia-local-core"
      },
      confidence,
      evidenceRefs: evidenceRefs ?? []
    };
  }

  private appendConnectorAudit(message: string, metadata?: Record<string, unknown>) {
    this.policy.appendAudit({
      auditId: this.nextId("audit"),
      workspaceId: this.config.workspaceId,
      actorId: "system:connector",
      actorType: "system",
      action: message,
      targetType: "connector",
      targetId: readString(metadata?.connectorId) ?? "unknown",
      timestamp: this.nowIso(),
      metadata: metadata ?? {}
    });
  }

  private appendSystemAudit(action: string, actorId: string, targetId: string, metadata: Record<string, unknown>) {
    this.policy.appendAudit({
      auditId: this.nextId("audit"),
      workspaceId: this.config.workspaceId,
      actorId,
      actorType: "system",
      action,
      targetType: "workflow",
      targetId,
      timestamp: this.nowIso(),
      metadata
    });
  }

  private resolveNamespace(run: Run, runEvents: WorkflowEvent[]): WorkflowNamespace {
    const metadata = run.metadata ?? {};
    const tenantId =
      readString(metadata.tenantId) ?? readString(metadata.tenant) ?? this.config.defaultTenantId ?? "local";

    const metadataDomain = readString(metadata.domain);
    const eventDomain = runEvents
      .map((event) => {
        const payloadDomain = readString(event.payload.domain);
        if (payloadDomain) return payloadDomain;
        const urlValue = readString(event.payload.url);
        if (!urlValue) return undefined;
        return domainFromUrl(urlValue);
      })
      .find((value) => Boolean(value));
    const domain = metadataDomain ?? eventDomain ?? "general";

    const taskFamily = readString(metadata.taskFamily) ?? taskFamilyFromObjective(run.objective);

    return {
      workspaceId: this.config.workspaceId,
      tenantId,
      domain,
      taskFamily
    };
  }

  private computeGateMetrics(snapshot: RunSnapshot): WorkflowGateMetrics {
    const alerts = evaluateRun(snapshot);
    const reasoningEvents = snapshot.events.filter(
      (event) => event.eventType === "reasoning.claim" || event.eventType === "reasoning.conclusion"
    );
    const conclusionEvents = snapshot.events.filter((event) => event.eventType === "reasoning.conclusion");
    const memoryReadCount = snapshot.events.filter((event) => event.eventType === "memory.read").length;
    const approvalCount = snapshot.events.filter((event) => event.eventType === "approval.granted").length;
    const privilegedCount = snapshot.events.filter((event) => event.eventType === "privileged_action.executed").length;
    const completedTasks = snapshot.tasks.filter((task) => task.state === "completed").length;

    const confidenceScores = reasoningEvents.map((event) => clampScore(event.confidence ?? 0.7, 0.7));
    const confidenceScore =
      confidenceScores.length === 0 ? 0.7 : clampScore(average(confidenceScores), 0.7);

    const explicitAgreement = snapshot.events
      .map((event) => event.payload.evaluatorAgreement)
      .filter((value): value is number => typeof value === "number")
      .map((value) => clampScore(value));

    const contradictionRate = clampScore(
      alerts.filter((alert) => alert.category === "contradiction").length / Math.max(1, conclusionEvents.length)
    );
    const evaluatorAgreement =
      explicitAgreement.length > 0
        ? clampScore(average(explicitAgreement), 0.72)
        : clampScore(1 - contradictionRate * 1.3, 0.72);

    const groundedConclusions = conclusionEvents.filter((event) => event.evidenceRefs.length > 0).length;
    const toolGroundingScore = clampScore(
      conclusionEvents.length === 0 ? 1 : groundedConclusions / Math.max(1, conclusionEvents.length)
    );

    const utilityRate = clampScore(
      snapshot.tasks.length === 0
        ? snapshot.run.status === "completed"
          ? 1
          : 0.6
        : completedTasks / Math.max(1, snapshot.tasks.length)
    );

    const staleUseRate = clampScore(
      alerts.filter((alert) => alert.category === "stale_memory").length / Math.max(1, memoryReadCount)
    );

    const evidenceKeys = new Set(
      snapshot.events.flatMap((event) =>
        event.evidenceRefs.map(
          (ref, index) => ref.eventId ?? ref.memoryVersionId ?? ref.source?.contentHash ?? `${event.eventId}:${index}`
        )
      )
    );
    if (evidenceKeys.size === 0 && snapshot.events.length > 0) {
      evidenceKeys.add(snapshot.events[0]?.eventId ?? "run-seed");
    }

    return {
      confidenceScore,
      evaluatorAgreement,
      toolGroundingScore,
      utilityRate,
      overlapRate: 0,
      contradictionRate,
      staleUseRate,
      evidencePacketCount: evidenceKeys.size,
      safeAutomationEvidenceCount: Math.min(approvalCount, privilegedCount)
    };
  }

  private buildEvidencePacket(snapshot: RunSnapshot): WorkflowEvidencePacket {
    const refs: WorkflowEvent["evidenceRefs"] = [];
    for (const event of snapshot.events) {
      if (refs.length >= 24) break;
      if (event.evidenceRefs.length > 0) {
        refs.push(...event.evidenceRefs.slice(0, Math.max(0, 24 - refs.length)));
      } else if (
        event.eventType === "tool_call.completed" ||
        event.eventType === "reasoning.conclusion" ||
        event.eventType === "memory.read"
      ) {
        refs.push({
          eventId: event.eventId,
          source: event.source
        });
      }
    }

    return {
      packetId: this.nextId("packet"),
      runId: snapshot.run.runId,
      generatedAt: this.nowIso(),
      summary: `Evidence packet derived from ${snapshot.events.length} events.`,
      refs
    };
  }

  private estimateImpact(snapshot: RunSnapshot): Severity {
    const alerts = evaluateRun(snapshot);
    const severities = alerts.map((alert) => alert.severity);

    if (snapshot.events.some((event) => event.eventType === "privileged_action.executed")) {
      severities.push("critical");
    }
    if (snapshot.events.some((event) => event.eventType === "approval.requested")) {
      severities.push("high");
    }
    if (severities.length === 0) return "low";
    return [...severities].sort((a, b) => severityRank(b) - severityRank(a))[0] ?? "low";
  }

  private evaluateCompatibility(namespace: WorkflowNamespace, objective: string) {
    const comparable = this.workflowCandidates.filter(
      (candidate) =>
        candidate.namespace.domain === namespace.domain &&
        candidate.namespace.taskFamily === namespace.taskFamily &&
        candidate.namespace.tenantId === namespace.tenantId &&
        (candidate.status === "promoted" || candidate.status === "pending_review")
    );

    const objectiveTokens = tokenSet(objective);
    const notes: string[] = [];
    const conflictWithWorkflowIds: string[] = [];
    const overlaps: number[] = [];

    for (const candidate of comparable) {
      const overlap = jaccardSimilarity(objectiveTokens, tokenSet(candidate.provenance.objectiveSnapshot));
      overlaps.push(overlap);
      if (overlap > 0.8) {
        notes.push(`High overlap with ${candidate.workflowId} (${overlap.toFixed(2)}).`);
      }

      const thisNegative = /\b(not|never|avoid|deny|reject)\b/.test(normalizeText(objective));
      const otherNegative = /\b(not|never|avoid|deny|reject)\b/.test(normalizeText(candidate.provenance.objectiveSnapshot));
      if (overlap > 0.94 || (overlap > 0.45 && thisNegative !== otherNegative)) {
        conflictWithWorkflowIds.push(candidate.workflowId);
      }
    }

    return {
      overlapRate: clampScore(Math.max(0, ...overlaps), 0),
      conflictWithWorkflowIds,
      notes
    };
  }

  private evaluatePromotionGates(candidate: WorkflowCandidate): string[] {
    const failures: string[] = [];
    const metrics = candidate.gateMetrics;
    const policy = candidate.policyAtDecisionTime;

    if (metrics.confidenceScore < policy.minConfidenceScore) failures.push("confidence_score_below_threshold");
    if (metrics.evaluatorAgreement < policy.minEvaluatorAgreement) failures.push("evaluator_agreement_below_threshold");
    if (metrics.toolGroundingScore < policy.minToolGroundingScore) failures.push("tool_grounding_score_below_threshold");
    if (metrics.utilityRate < policy.minUtilityRate) failures.push("utility_rate_below_threshold");
    if (metrics.overlapRate > policy.maxOverlapRate) failures.push("overlap_rate_above_threshold");
    if (metrics.contradictionRate > policy.maxContradictionRate) failures.push("contradiction_rate_above_threshold");
    if (metrics.staleUseRate > policy.maxStaleUseRate) failures.push("stale_use_rate_above_threshold");
    if (metrics.evidencePacketCount < policy.minEvidencePacketCount) failures.push("insufficient_evidence_packet_count");
    if (metrics.safeAutomationEvidenceCount < policy.minSafeAutomationEvidenceCount) {
      failures.push("insufficient_safe_automation_evidence");
    }
    if (candidate.conflictWithWorkflowIds.length > 0) failures.push("workflow_conflict_detected");

    return failures;
  }

  private requiresHumanApproval(candidate: WorkflowCandidate, policy: WorkflowPromotionPolicy): boolean {
    if (!policy.requireHumanApprovalForHighImpact) return false;
    return candidate.impactLevel === "high" || candidate.impactLevel === "critical";
  }

  private buildWorkflowTitle(objective: string, namespace: WorkflowNamespace): string {
    const shortened = normalizeText(objective).split(" ").slice(0, 7).join(" ");
    return `${namespace.taskFamily}: ${shortened.length > 0 ? shortened : "workflow"}`;
  }

  private buildWorkflowSummary(snapshot: RunSnapshot): string {
    const completed = snapshot.tasks.filter((task) => task.state === "completed").length;
    const taskSummary = `${completed}/${snapshot.tasks.length} tasks completed`;
    const eventSummary = `${snapshot.events.length} workflow events`;
    return `Derived from objective "${snapshot.run.objective}". ${taskSummary}; ${eventSummary}.`;
  }

  private getPromotionRequestedAt(workflowId: string): string | undefined {
    const requested = [...this.events]
      .reverse()
      .find(
        (event) =>
          event.eventType === "workflow.promotion_requested" && readString(event.payload.workflowId) === workflowId
      );
    return requested?.timestamp;
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
