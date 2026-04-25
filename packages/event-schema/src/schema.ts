import { z } from "zod";

export const isoDateTime = z.string().datetime({ offset: true });

export const severitySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof severitySchema>;

export const confidenceBandSchema = z.enum(["low", "medium", "high"]);
export type ConfidenceBand = z.infer<typeof confidenceBandSchema>;

export const eventTypeSchema = z.enum([
  "run.started",
  "run.completed",
  "run.failed",
  "task.created",
  "task.updated",
  "task.completed",
  "tool_call.started",
  "tool_call.completed",
  "tool_call.failed",
  "memory.read",
  "memory.changed",
  "checkpoint.created",
  "reasoning.claim",
  "reasoning.conclusion",
  "approval.requested",
  "approval.granted",
  "approval.denied",
  "privileged_action.attempted",
  "privileged_action.blocked",
  "privileged_action.executed"
]);
export type EventType = z.infer<typeof eventTypeSchema>;

export const reasoningAlertCategorySchema = z.enum([
  "unsupported_assumption",
  "stale_memory",
  "contradiction",
  "hallucination_risk",
  "evidence_gap",
  "loop_behavior",
  "tool_mismatch",
  "overconfidence_without_verification",
  "task_drift",
  "unsafe_automation_escalation"
]);
export type ReasoningAlertCategory = z.infer<typeof reasoningAlertCategorySchema>;

export const sourceReferenceSchema = z.object({
  connectorId: z.string(),
  filePath: z.string().optional(),
  objectPath: z.string().optional(),
  contentHash: z.string().optional()
});
export type SourceReference = z.infer<typeof sourceReferenceSchema>;

export const evidenceReferenceSchema = z.object({
  eventId: z.string().optional(),
  memoryVersionId: z.string().optional(),
  source: sourceReferenceSchema.optional(),
  excerpt: z.string().optional()
});
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;

export const workspaceSchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  ownerType: z.enum(["individual", "team", "enterprise"]),
  createdAt: isoDateTime
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const agentSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  type: z.enum(["assistant", "operator", "automation", "custom"]),
  connectorId: z.string(),
  status: z.enum(["idle", "running", "blocked", "failed", "completed"]),
  createdAt: isoDateTime,
  updatedAt: isoDateTime
});
export type Agent = z.infer<typeof agentSchema>;

export const runSchema = z.object({
  runId: z.string(),
  workspaceId: z.string(),
  agentId: z.string(),
  objective: z.string(),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  startedAt: isoDateTime,
  endedAt: isoDateTime.optional(),
  parentRunId: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});
export type Run = z.infer<typeof runSchema>;

export const taskSchema = z.object({
  taskId: z.string(),
  runId: z.string(),
  title: z.string(),
  planOrder: z.number().int().nonnegative(),
  state: z.enum(["planned", "active", "blocked", "completed", "cancelled"]),
  ownerAgentId: z.string(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime
});
export type Task = z.infer<typeof taskSchema>;

export const memoryObjectSchema = z.object({
  memoryId: z.string(),
  workspaceId: z.string(),
  sourcePath: z.string(),
  sourceType: z.enum(["memory.md", "bootstrap.md", "notes", "prompt", "other"]),
  sectionKey: z.string(),
  latestVersionId: z.string(),
  tags: z.array(z.string()).default([])
});
export type MemoryObject = z.infer<typeof memoryObjectSchema>;

export const memoryVersionSchema = z.object({
  versionId: z.string(),
  memoryId: z.string(),
  createdAt: isoDateTime,
  contentHash: z.string(),
  content: z.string(),
  authorType: z.enum(["agent", "user", "system", "connector"]),
  authorId: z.string().optional(),
  provenance: sourceReferenceSchema,
  parentVersionId: z.string().optional(),
  diffSummary: z.string().optional()
});
export type MemoryVersion = z.infer<typeof memoryVersionSchema>;

export const workflowEventSchema = z.object({
  eventId: z.string(),
  workspaceId: z.string(),
  agentId: z.string(),
  runId: z.string(),
  taskId: z.string().optional(),
  eventType: eventTypeSchema,
  timestamp: isoDateTime,
  payload: z.record(z.unknown()),
  source: sourceReferenceSchema,
  confidence: z.number().min(0).max(1).optional(),
  evidenceRefs: z.array(evidenceReferenceSchema).default([])
});
export type WorkflowEvent = z.infer<typeof workflowEventSchema>;

export const reasoningAlertSchema = z.object({
  alertId: z.string(),
  workspaceId: z.string(),
  runId: z.string(),
  agentId: z.string(),
  category: reasoningAlertCategorySchema,
  severity: severitySchema,
  confidence: z.number().min(0).max(1),
  confidenceBand: confidenceBandSchema,
  status: z.enum(["open", "acknowledged", "dismissed", "resolved"]),
  title: z.string(),
  explanation: z.string(),
  evidenceRefs: z.array(evidenceReferenceSchema).default([]),
  createdAt: isoDateTime,
  updatedAt: isoDateTime
});
export type ReasoningAlert = z.infer<typeof reasoningAlertSchema>;

export const userFeedbackSchema = z.object({
  feedbackId: z.string(),
  alertId: z.string(),
  userId: z.string(),
  disposition: z.enum(["helpful", "false_positive", "needs_review"]),
  note: z.string().optional(),
  createdAt: isoDateTime
});
export type UserFeedback = z.infer<typeof userFeedbackSchema>;

export const permissionGrantSchema = z.object({
  grantId: z.string(),
  workspaceId: z.string(),
  subjectId: z.string(),
  scopeType: z.enum(["connector", "file_path", "workspace", "event_type", "sync_mode"]),
  scopeValue: z.string(),
  grantMode: z.enum(["one_time", "session", "persistent"]),
  grantedBy: z.string(),
  grantedAt: isoDateTime,
  expiresAt: isoDateTime.optional(),
  revokedAt: isoDateTime.optional(),
  rationale: z.string().optional()
});
export type PermissionGrant = z.infer<typeof permissionGrantSchema>;

export const auditEntrySchema = z.object({
  auditId: z.string(),
  workspaceId: z.string(),
  actorId: z.string(),
  actorType: z.enum(["user", "agent", "system", "connector"]),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  timestamp: isoDateTime,
  metadata: z.record(z.unknown()).default({}),
  chainHash: z.string(),
  previousHash: z.string().optional()
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const runSnapshotSchema = z.object({
  run: runSchema,
  tasks: z.array(taskSchema),
  events: z.array(workflowEventSchema),
  memoryVersions: z.array(memoryVersionSchema)
});
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;