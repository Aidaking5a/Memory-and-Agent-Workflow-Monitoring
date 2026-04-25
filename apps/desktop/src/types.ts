export type ViewKey =
  | "overview"
  | "agents"
  | "timeline"
  | "memory"
  | "alerts"
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
}