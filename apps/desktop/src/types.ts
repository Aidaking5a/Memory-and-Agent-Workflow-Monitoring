export type ViewKey =
  | "overview"
  | "agents"
  | "timeline"
  | "memory"
  | "alerts"
  | "governance"
  | "compare"
  | "audit"
  | "settings";

export interface HealthMetric {
  label: string;
  value: string;
  trend?: string;
}

export interface AgentHealth {
  agentId: string;
  name: string;
  status: "idle" | "running" | "blocked" | "failed" | "completed";
  activeRunId?: string;
  riskScore: number;
  staleMemoryCount: number;
  openAlerts: number;
}

export interface TimelineItem {
  eventId: string;
  ts: string;
  eventType: string;
  agent: string;
  summary: string;
}

export interface MemoryItem {
  memoryId: string;
  sourcePath: string;
  sectionKey: string;
  latestVersionId: string;
  updatedAt: string;
}

export interface AlertItem {
  alertId: string;
  category: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  confidence: number;
  title: string;
  explanation: string;
  runId: string;
  status: "open" | "acknowledged" | "dismissed" | "resolved";
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
  status: "healthy" | "degraded" | "offline";
  lastSync: string;
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
  workspaceName: string;
  timeRange: string;
  metrics: HealthMetric[];
  agents: AgentHealth[];
  timeline: TimelineItem[];
  memory: MemoryItem[];
  alerts: AlertItem[];
  comparison: ComparisonRow[];
  audit: AuditRow[];
  connectors: ConnectorRow[];
  workflowCandidates: WorkflowCandidateRow[];
  workflowReport: WorkflowReleaseGateSummary;
  workflowPolicy: WorkflowPolicyView;
}
