import { z } from "zod";

export const agentProtocolVersionSchema = z.literal("agent-activity/v1");
export type AgentProtocolVersion = z.infer<typeof agentProtocolVersionSchema>;

export const agentActivityCategorySchema = z.enum([
  "coding",
  "research",
  "browsing",
  "planning",
  "writing",
  "design",
  "finance",
  "operations",
  "customer_support",
  "file_management",
  "memory_update",
  "tool_execution",
  "idle",
  "blocked",
  "error"
]);
export type AgentActivityCategory = z.infer<typeof agentActivityCategorySchema>;

export const agentStatusSchema = z.enum([
  "active",
  "idle",
  "waiting",
  "blocked",
  "collaborating",
  "stopped",
  "emergency-stopped",
  "disconnected",
  "failed"
]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const agentConnectionKindSchema = z.enum(["local", "api", "oauth", "openclaw", "terminal", "custom"]);
export type AgentConnectionKind = z.infer<typeof agentConnectionKindSchema>;

export const agentRiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type AgentRiskLevel = z.infer<typeof agentRiskLevelSchema>;

export const agentControlLevelSchema = z.enum([
  "observe_only",
  "query",
  "pause_resume",
  "steer",
  "stop",
  "full"
]);
export type AgentControlLevel = z.infer<typeof agentControlLevelSchema>;

export const agentLinkStatusSchema = z.enum(["proposed", "active", "paused", "blocked", "broken", "expired"]);
export type AgentLinkStatus = z.infer<typeof agentLinkStatusSchema>;

export const agentControlActionSchema = z.enum([
  "query",
  "emergency_stop",
  "steer",
  "pause",
  "resume",
  "disconnect",
  "make_link",
  "break_link",
  "focus_together"
]);
export type AgentControlAction = z.infer<typeof agentControlActionSchema>;

export const agentControlCommandStatusSchema = z.enum([
  "requested",
  "accepted",
  "rejected",
  "running",
  "completed",
  "failed",
  "cancelled"
]);
export type AgentControlCommandStatus = z.infer<typeof agentControlCommandStatusSchema>;

export const targetKindSchema = z.enum([
  "website",
  "api",
  "app",
  "local_file",
  "repo",
  "terminal",
  "external_service",
  "openclaw_session",
  "skill",
  "tool",
  "connector"
]);
export type TargetKind = z.infer<typeof targetKindSchema>;

export const agentToolCallSchema = z.object({
  callId: z.string().optional(),
  name: z.string(),
  kind: z.enum(["tool", "skill", "connector", "api", "terminal"]).default("tool"),
  status: z.enum(["started", "completed", "failed", "blocked"]).default("completed"),
  startedAt: z.string().datetime({ offset: true }).optional(),
  endedAt: z.string().datetime({ offset: true }).optional(),
  safeSummary: z.string().max(800).optional()
});
export type AgentToolCall = z.infer<typeof agentToolCallSchema>;

export const agentTargetSchema = z.object({
  kind: targetKindSchema,
  label: z.string().max(160),
  ref: z.string().max(600).optional(),
  redacted: z.boolean().default(false)
});
export type AgentTarget = z.infer<typeof agentTargetSchema>;

export const agentUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  model: z.string().max(160).optional(),
  vendor: z.string().max(160).optional(),
  apiProvider: z.string().max(160).optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  paidServices: z.array(z.string().max(160)).default([]),
  runtimeMs: z.number().int().nonnegative().optional(),
  cpuPercent: z.number().min(0).max(100).optional(),
  ramBytes: z.number().int().nonnegative().optional(),
  gpuPercent: z.number().min(0).max(100).optional(),
  vramBytes: z.number().int().nonnegative().optional(),
  memoryFiles: z.array(z.string().max(600)).default([]),
  logBytes: z.number().int().nonnegative().optional()
});
export type AgentUsage = z.infer<typeof agentUsageSchema>;

export const agentProfileSchema = z.object({
  agentId: z.string().min(1).max(180),
  name: z.string().min(1).max(160),
  role: z.string().max(160).default("Agent"),
  domain: z.string().max(120).default("general"),
  model: z.string().max(160).optional(),
  vendor: z.string().max(160).optional(),
  connectionKind: agentConnectionKindSchema,
  status: agentStatusSchema.default("idle"),
  endpointLabel: z.string().max(240).optional(),
  tools: z.array(z.string().max(140)).default([]),
  skills: z.array(z.string().max(140)).default([]),
  connectors: z.array(z.string().max(140)).default([]),
  memorySummary: z.string().max(1200).optional(),
  soulSummary: z.string().max(1200).optional(),
  controlLevel: agentControlLevelSchema.default("observe_only"),
  canCollaborate: z.boolean().default(false),
  canEmergencyStop: z.boolean().default(false),
  trustLevel: z.enum(["low", "standard", "trusted", "restricted"]).default("standard"),
  registeredAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});
export type AgentProfile = z.infer<typeof agentProfileSchema>;

export const agentActivityEventSchema = z.object({
  schemaVersion: agentProtocolVersionSchema.default("agent-activity/v1"),
  eventId: z.string().min(1).max(220),
  timestamp: z.string().datetime({ offset: true }),
  sequence: z.number().int().nonnegative().optional(),
  workspaceId: z.string().min(1).max(180),
  runId: z.string().min(1).max(220).optional(),
  taskId: z.string().max(220).optional(),
  agent: agentProfileSchema.pick({
    agentId: true,
    name: true,
    role: true,
    domain: true,
    model: true,
    vendor: true,
    connectionKind: true
  }),
  classification: z.object({
    category: agentActivityCategorySchema,
    customCategory: z
      .string()
      .regex(/^[a-z][a-z0-9_]{2,31}$/)
      .optional(),
    status: agentStatusSchema,
    riskLevel: agentRiskLevelSchema.default("low"),
    confidence: z.number().min(0).max(1).default(0.75)
  }),
  what: z.object({
    objective: z.string().max(1000).optional(),
    currentTask: z.string().max(1000).optional(),
    safeSummary: z.string().max(1400),
    decisionTrace: z.array(z.string().max(400)).default([])
  }),
  where: z.object({
    targets: z.array(agentTargetSchema).default([])
  }),
  how: z.object({
    toolCalls: z.array(agentToolCallSchema).default([]),
    filesAccessed: z.array(z.string().max(600)).default([]),
    websitesVisited: z.array(z.string().max(600)).default([]),
    apiCalls: z.array(z.string().max(400)).default([]),
    collaborationLinkIds: z.array(z.string().max(220)).default([]),
    userVisibleExplanation: z.string().max(1400).optional()
  }),
  usage: agentUsageSchema.default({}),
  privacy: z.object({
    redactionApplied: z.boolean().default(true),
    sensitiveKinds: z.array(z.string().max(120)).default([]),
    rawLogRef: z.string().max(600).optional()
  }).default({}),
  integrity: z.object({
    pairingId: z.string().max(220).optional(),
    keyId: z.string().max(220).optional(),
    signature: z.string().max(600).optional()
  }).default({})
});
export type AgentActivityEvent = z.infer<typeof agentActivityEventSchema>;

export const collaborationLinkSchema = z.object({
  linkId: z.string().min(1).max(220),
  sourceAgentId: z.string().min(1).max(180),
  targetAgentId: z.string().min(1).max(180),
  status: agentLinkStatusSchema,
  taskScope: z.string().max(1000),
  permissions: z.array(z.string().max(160)).default([]),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  createdBy: z.string().max(220),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  lastActivityAt: z.string().datetime({ offset: true }).optional()
});
export type CollaborationLink = z.infer<typeof collaborationLinkSchema>;

export const agentControlCommandSchema = z.object({
  commandId: z.string().min(1).max(220),
  action: agentControlActionSchema,
  status: agentControlCommandStatusSchema.default("requested"),
  actorId: z.string().min(1).max(220),
  agentIds: z.array(z.string().min(1).max(180)).default([]),
  linkIds: z.array(z.string().min(1).max(220)).default([]),
  reason: z.string().max(1000).optional(),
  instruction: z.string().max(1800).optional(),
  highRisk: z.boolean().default(false),
  requiresConfirmation: z.boolean().default(false),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  resultSummary: z.string().max(1400).optional(),
  affectedResources: z.array(z.string().max(600)).default([]),
  auditId: z.string().max(220).optional()
});
export type AgentControlCommand = z.infer<typeof agentControlCommandSchema>;

export const resourceSampleSchema = z.object({
  sampleId: z.string().min(1).max(220),
  workspaceId: z.string().min(1).max(180),
  agentId: z.string().min(1).max(180).optional(),
  timestamp: z.string().datetime({ offset: true }),
  cpuPercent: z.number().min(0).max(100).optional(),
  ramBytes: z.number().int().nonnegative().optional(),
  gpuPercent: z.number().min(0).max(100).optional(),
  vramBytes: z.number().int().nonnegative().optional(),
  runtimeMs: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  estimatedCostUsd: z.number().nonnegative().optional()
});
export type ResourceSample = z.infer<typeof resourceSampleSchema>;

export const orchestratorConfigSchema = z.object({
  categories: z.array(agentActivityCategorySchema).default(agentActivityCategorySchema.options),
  customCategoryPattern: z.string().default("^[a-z][a-z0-9_]{2,31}$"),
  defaultControlLevel: agentControlLevelSchema.default("observe_only"),
  requireConfirmationFor: z.array(agentControlActionSchema).default(["emergency_stop", "make_link", "focus_together"]),
  costWarningUsdPerHour: z.number().nonnegative().default(5),
  tokenWarningPerHour: z.number().int().nonnegative().default(500000)
});
export type OrchestratorConfig = z.infer<typeof orchestratorConfigSchema>;
