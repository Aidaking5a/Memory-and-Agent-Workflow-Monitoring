export type ViewKey =
  | "onboarding"
  | "overview"
  | "agents"
  | "timeline"
  | "memory"
  | "alerts"
  | "governance"
  | "compare"
  | "audit"
  | "settings";

export type OperatorRole = "owner" | "operator" | "reviewer" | "auditor" | "read_only";

export type OperatorCapability =
  | "setup:write"
  | "plugin:write"
  | "alert:write"
  | "workflow:review"
  | "workflow:rollback"
  | "workflow:retire"
  | "workflow:policy:write";

export interface HealthMetric {
  label: string;
  value: string;
  trend?: string;
}

export interface SetupHealthCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface SetupState {
  connected: boolean;
  connectionMethod: "workspace_scan" | "manual_paths" | "unknown";
  workspacePath?: string;
  discoveredSources: {
    memoryPath?: string;
    bootstrapPath?: string;
    codexLogPaths: string[];
    customJsonLogPaths: string[];
    openClawLogPaths: string[];
  };
  permissions: {
    workspaceAccessGranted: boolean;
    readMemoryFiles: boolean;
    readWorkflowEvents: boolean;
    readPrompts: boolean;
  };
  lastDiscoveredAt?: string;
  lastConnectedAt?: string;
  lastValidatedAt?: string;
  health: {
    status: "healthy" | "degraded" | "offline";
    checks: SetupHealthCheck[];
  };
  runtime: {
    enabled: boolean;
    mode: "hybrid" | "log_only" | "rpc_only";
    endpoint?: string;
    hasApiKey: boolean;
    cursor?: string;
    lastSyncAt?: string;
    lastError?: string;
    lastEventCount: number;
  };
}

export interface AgentHealth {
  agentId: string;
  name: string;
  status: "idle" | "running" | "blocked" | "failed" | "completed";
  activeRunId?: string;
  riskScore: number;
  staleMemoryCount: number;
  openAlerts: number;
  tokens24h: number;
  workloadPressure: number;
  memoryFreshness: number;
  connectorStability: number;
  currentObjective?: string;
  lastEventAt?: string;
}

export interface TimelineItem {
  eventId: string;
  ts: string;
  eventType: string;
  agent: string;
  summary: string;
  runId: string;
  confidence?: number;
}

export interface MemoryItem {
  memoryId: string;
  sourcePath: string;
  sectionKey: string;
  heading: string;
  latestVersionId: string;
  updatedAt?: string;
  contentPreview: string;
}

export interface MemoryDocument {
  sourcePath: string;
  sectionCount: number;
  lastUpdatedAt?: string;
  sections: MemoryItem[];
}

export interface MemoryChange {
  eventId: string;
  sourcePath: string;
  ts: string;
  summary: string;
  runId: string;
  agentId: string;
}

export interface MemoryImpactLink {
  alertId: string;
  category: string;
  severity: string;
  runId: string;
  sourcePath: string;
  sectionKey: string;
  explanation: string;
}

export interface AlertItem {
  alertId: string;
  category: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  confidence: number;
  title: string;
  explanation: string;
  runId: string;
  agentId: string;
  status: "open" | "acknowledged" | "dismissed" | "resolved";
  createdAt: string;
  updatedAt?: string;
  evidenceCount: number;
}

export interface OperatorContext {
  role: OperatorRole;
  actorId: string;
  capabilities: OperatorCapability[];
}

export interface RunSummary {
  runId: string;
  agentId: string;
  objective: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  endedAt?: string;
  eventCount: number;
  tokenTotal: number;
  lastEventAt?: string;
}

export interface TokenSeriesPoint {
  bucket: string;
  label: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface WorkloadSeriesPoint {
  bucket: string;
  label: string;
  events: number;
  tokens: number;
}

export interface ComparisonRow {
  metric: string;
  alphaAgent: string;
  betaAgent: string;
}

export interface AuditRow {
  ts: string;
  actor: string;
  action: string;
  target: string;
  result: string;
}

export interface ConnectorRow {
  connectorId: string;
  scope: string;
  status: "healthy" | "degraded" | "offline" | "disabled";
  lastSync: string;
  enabled: boolean;
  syncHealth: string;
}

export interface PluginRow {
  pluginId: string;
  name: string;
  description: string;
  capabilities: string[];
  enabled: boolean;
  status: "healthy" | "degraded" | "offline" | "disabled";
  syncHealth: string;
  sourceCount: number;
  lastSync?: string;
}

export interface WorkflowCandidateRow {
  workflowId: string;
  title: string;
  status: "candidate" | "pending_review" | "promoted" | "rejected" | "rolled_back" | "retired" | "expired";
  impactLevel: "info" | "low" | "medium" | "high" | "critical";
  namespace: string;
  confidenceScore: number;
  utilityRate: number;
  overlapRate: number;
  contradictionRate: number;
  staleUseRate: number;
  conflictCount: number;
  updatedAt: string;
}

export interface WorkflowReleaseGateSummary {
  totalCandidates: number;
  promotedCandidates: number;
  pendingReviewCandidates: number;
  rejectedCandidates: number;
  rolledBackCandidates: number;
  conflictOpenCount: number;
  avgConfidenceScore: number;
  avgUtilityRate: number;
  avgContradictionRate: number;
  avgStaleUseRate: number;
}

export interface WorkflowPolicyView {
  minConfidenceScore: number;
  minEvaluatorAgreement: number;
  minToolGroundingScore: number;
  minUtilityRate: number;
  maxOverlapRate: number;
  maxContradictionRate: number;
  maxStaleUseRate: number;
  minEvidencePacketCount: number;
  minSafeAutomationEvidenceCount: number;
  requireHumanApprovalForHighImpact: boolean;
}

export interface DashboardData {
  generatedAt: string;
  workspaceId: string;
  workspaceName: string;
  timeRange: string;
  connection: SetupState;
  operator: OperatorContext;
  metrics: HealthMetric[];
  runs: RunSummary[];
  agents: AgentHealth[];
  timeline: TimelineItem[];
  memory: MemoryItem[];
  memoryDocuments: MemoryDocument[];
  memoryChanges: MemoryChange[];
  memoryImpactLinks: MemoryImpactLink[];
  alerts: AlertItem[];
  tokenSeries: TokenSeriesPoint[];
  workloadSeries: WorkloadSeriesPoint[];
  comparison: ComparisonRow[];
  audit: AuditRow[];
  connectors: ConnectorRow[];
  plugins: PluginRow[];
  workflowCandidates: WorkflowCandidateRow[];
  workflowReport: WorkflowReleaseGateSummary;
  workflowPolicy: WorkflowPolicyView;
  ingestSummary: {
    latestEventCount: number;
    latestMemoryObjects: number;
    latestMemoryVersions: number;
  };
}
