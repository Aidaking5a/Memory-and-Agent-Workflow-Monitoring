export type ViewKey =
  | "dashboard"
  | "network"
  | "stats"
  | "cards"
  | "activity"
  | "costs"
  | "security"
  | "settings"
  | "help";

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
    transport: "gateway_cli" | "event_feed";
    endpoint?: string;
    hasApiKey: boolean;
    cursor?: string;
    cliCommand?: string;
    cliTimeoutMs: number;
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

export type AgentConnectionKind = "local" | "api" | "oauth" | "openclaw" | "terminal" | "custom";
export type AgentControlLevel = "observe_only" | "query" | "pause_resume" | "steer" | "stop" | "full";
export type AgentNetworkStatus =
  | "active"
  | "idle"
  | "waiting"
  | "blocked"
  | "collaborating"
  | "stopped"
  | "emergency-stopped"
  | "disconnected"
  | "failed";
export type AgentActivityCategory =
  | "coding"
  | "research"
  | "browsing"
  | "planning"
  | "writing"
  | "design"
  | "finance"
  | "operations"
  | "customer_support"
  | "file_management"
  | "memory_update"
  | "tool_execution"
  | "idle"
  | "blocked"
  | "error";
export type AgentNetworkControlAction =
  | "query"
  | "emergency_stop"
  | "steer"
  | "pause"
  | "resume"
  | "disconnect"
  | "make_link"
  | "break_link"
  | "focus_together";

export interface AgentNetworkTarget {
  kind: string;
  label: string;
  ref?: string;
  redacted?: boolean;
}

export interface AgentNetworkToolCall {
  callId?: string;
  name: string;
  kind: "tool" | "skill" | "connector" | "api" | "terminal";
  status: "started" | "completed" | "failed" | "blocked";
  safeSummary?: string;
}

export interface AgentNetworkUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  vendor?: string;
  apiProvider?: string;
  estimatedCostUsd?: number;
  paidServices?: string[];
  runtimeMs?: number;
  cpuPercent?: number;
  ramBytes?: number;
  gpuPercent?: number;
  vramBytes?: number;
  memoryFiles?: string[];
  logBytes?: number;
}

export interface AgentNetworkEventSummary {
  eventId: string;
  timestamp: string;
  sequence?: number;
  agentId: string;
  agentName: string;
  category: AgentActivityCategory;
  customCategory?: string;
  status: AgentNetworkStatus;
  riskLevel: "low" | "medium" | "high" | "critical";
  confidence: number;
  objective?: string;
  currentTask?: string;
  safeSummary: string;
  decisionTrace: string[];
  targets: AgentNetworkTarget[];
  toolCalls: AgentNetworkToolCall[];
  filesAccessed: string[];
  websitesVisited: string[];
  apiCalls: string[];
  collaborationLinkIds: string[];
  userVisibleExplanation?: string;
  usage: AgentNetworkUsage;
  privacy: {
    redactionApplied: boolean;
    sensitiveKinds: string[];
    rawLogRef?: string;
  };
}

export interface AgentNetworkStats {
  eventCount: number;
  tokens: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  estimatedCostUsd: number;
  runtimeMs: number;
  cpuPercent: number;
  ramBytes: number;
  gpuPercent: number;
  vramBytes: number;
  memoryFiles: string[];
  paidServices: string[];
  logBytes: number;
  lastEventAt?: string;
}

export interface AgentCommandCenterAgent {
  agentId: string;
  name: string;
  role: string;
  domain: string;
  model?: string;
  vendor?: string;
  connectionKind: AgentConnectionKind;
  status: AgentNetworkStatus;
  endpointLabel?: string;
  tools: string[];
  skills: string[];
  connectors: string[];
  memorySummary?: string;
  soulSummary?: string;
  controlLevel: AgentControlLevel;
  canCollaborate: boolean;
  canEmergencyStop: boolean;
  trustLevel: "low" | "standard" | "trusted" | "restricted";
  registeredAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  hasTelemetryToken?: boolean;
  telemetryRevokedAt?: string;
  tokenCreatedAt?: string;
  stats: AgentNetworkStats;
  latestEvent?: AgentNetworkEventSummary;
  activityScore: number;
  bubbleSize: number;
  bubbleState:
    | "active"
    | "idle"
    | "blocked"
    | "collaborating"
    | "high-cost"
    | "warning"
    | "stopped"
    | "emergency-stopped";
  networkPosition: {
    x: number;
    y: number;
  };
  activeLinkCount: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costEstimateUsd: number;
  currentTool?: string;
  currentTarget?: AgentNetworkTarget;
  currentTask?: string;
  safeReasoningSummary: string[];
}

export interface AgentCommandCenterLink {
  linkId: string;
  sourceAgentId: string;
  targetAgentId: string;
  status: "proposed" | "active" | "paused" | "blocked" | "broken" | "expired";
  taskScope: string;
  permissions: string[];
  priority: "low" | "normal" | "high";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  lastActivityAt?: string;
}

export interface AgentNetworkCommand {
  commandId: string;
  action: AgentNetworkControlAction;
  status: "requested" | "accepted" | "rejected" | "running" | "completed" | "failed" | "cancelled";
  actorId: string;
  agentIds: string[];
  linkIds: string[];
  reason?: string;
  instruction?: string;
  highRisk: boolean;
  requiresConfirmation: boolean;
  createdAt: string;
  updatedAt: string;
  resultSummary?: string;
  affectedResources: string[];
}

export interface AgentNetworkSnapshot {
  generatedAt: string;
  workspaceId: string;
  workspaceName: string;
  protocolVersion: "agent-activity/v1";
  orchestrator: {
    agentId: string;
    name: string;
    status: AgentNetworkStatus;
    soulSummary?: string;
    memorySummary?: string;
    telemetryEndpoint: string;
    streamEndpoint: string;
    categories: AgentActivityCategory[];
    customCategoryPattern: string;
  };
  stats: {
    activeAgents: number;
    totalAgents: number;
    stoppedAgents: number;
    activeLinks: number;
    blockedLinks: number;
    recentEvents: number;
    tokens: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      runtimeMs: number;
      logBytes: number;
    };
    estimatedSpendUsd: number;
    runtimeMs: number;
    logBytes: number;
    system: {
      platform: string;
      arch: string;
      cpus: number;
      loadAverage: number[];
      totalRamBytes: number;
      freeRamBytes: number;
      usedRamBytes: number;
      processRamBytes: number;
      uptimeSeconds: number;
    };
    perAgent: Array<{
      agentId: string;
      name: string;
      status: AgentNetworkStatus;
      tokens: number;
      estimatedCostUsd: number;
      runtimeMs: number;
      cpuPercent: number;
      ramBytes: number;
      activityScore: number;
    }>;
  };
  agents: AgentCommandCenterAgent[];
  links: AgentCommandCenterLink[];
  events: AgentNetworkEventSummary[];
  commands: AgentNetworkCommand[];
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

export type HighRiskSeverity = "medium" | "high" | "critical";
export type HighRiskNotificationChannel = "in_app_banner" | "email" | "webhook";
export type HighRiskNotificationDeliveryStatus = "queued" | "retrying" | "sent" | "failed" | "suppressed";
export type HighRiskNotificationStatus = "open" | "acknowledged" | "resolved";
export type HighRiskDedupeStatus =
  | "dispatched"
  | "filtered_threshold"
  | "suppressed_dedupe"
  | "suppressed_cooldown"
  | "suppressed_rate_limit"
  | "quiet_hours"
  | "disabled";

export interface HighRiskNotificationChannelState {
  channel: HighRiskNotificationChannel;
  status: HighRiskNotificationDeliveryStatus;
  attempts: number;
  queuedAt?: string;
  lastAttemptAt?: string;
  sentAt?: string;
  latencyMs?: number;
  lastError?: string;
  nextRetryAt?: string;
}

export interface HighRiskNotificationRecord {
  notificationId: string;
  riskId: string;
  sourceEventId: string;
  sourceEventType: string;
  category: string;
  severity: HighRiskSeverity;
  confidence: number;
  triggerRule: string;
  title: string;
  explanation: string;
  recommendedNextAction: string;
  dedupeStatus: HighRiskDedupeStatus;
  suppressionReason?: string;
  agentId: string;
  runId: string;
  affectedResource?: string;
  toolName?: string;
  occurredAt: string;
  detectedAt: string;
  status: HighRiskNotificationStatus;
  acknowledgedAt?: string;
  resolvedAt?: string;
  escalatedAt?: string;
  channels: HighRiskNotificationChannelState[];
  signals: string[];
  firstDispatchedAt?: string;
  firstDispatchLatencyMs?: number;
  pipeline: Array<{
    stage: string;
    at: string;
    detail: string;
  }>;
}

export interface HighRiskNotificationSettingsView {
  enabled: boolean;
  minimumSeverity: HighRiskSeverity;
  minimumConfidence: number;
  dedupeWindowSeconds: number;
  cooldownSeconds: number;
  antiSpamWindowSeconds: number;
  maxNotificationsPerWindow: number;
  channels: {
    inAppBanner: boolean;
    email: boolean;
    webhook: boolean;
  };
  quietHours: {
    enabled: boolean;
    startLocal: string;
    endLocal: string;
    allowCritical: boolean;
  };
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  routing: {
    defaultRecipients: string[];
    criticalRecipients: string[];
  };
  escalation: {
    enabled: boolean;
    severityAtLeast: "high" | "critical";
    afterMinutes: number;
    additionalRecipients: string[];
    escalateToWebhook: boolean;
  };
  email: {
    fromAddress: string;
    smtpHost?: string;
    smtpPort: number;
    secure: boolean;
    smtpUsername?: string;
    connectTimeoutMs: number;
    subjectPrefix: string;
    configured: boolean;
    hasPassword: boolean;
  };
  webhook: {
    url?: string;
    timeoutMs: number;
    configured: boolean;
    hasBearerToken: boolean;
  };
  slo: {
    p95DispatchTargetMs: number;
  };
}

export interface HighRiskNotificationTaxonomyRule {
  category: string;
  label: string;
  trigger: string;
  defaultSeverity: HighRiskSeverity;
}

export interface NotificationCenterData {
  settings: HighRiskNotificationSettingsView;
  taxonomy: HighRiskNotificationTaxonomyRule[];
  history: HighRiskNotificationRecord[];
  banner?: HighRiskNotificationRecord;
  pipeline: {
    detected: number;
    dispatched: number;
    suppressed: number;
    suppressedBreakdown: Record<HighRiskDedupeStatus, number>;
    averageDetectionMs: number;
    p95DetectionMs: number;
  };
  slo: {
    targetP95Ms: number;
    measuredP95Ms: number;
    measuredP50Ms: number;
    sampleSize: number;
    withinTarget: boolean;
    lastDispatchAt?: string;
    queueDepth: number;
    failedDeliveryCount24h: number;
  };
}

export interface OperatorContext {
  role: OperatorRole;
  actorId: string;
  capabilities: OperatorCapability[];
  userId?: string;
  sessionId?: string;
}

export interface AuthSessionUser {
  userId: string;
  email: string;
  role: "owner" | "member";
}

export interface AuthSessionPayload {
  token: string;
  expiresAt: string;
  user: AuthSessionUser;
}

export interface EmergencySafetyState {
  status: "ready" | "stopping" | "stopped" | "failed" | string;
  isStopped: boolean;
  stopping: boolean;
  restartAvailable: boolean;
  triggeredBy?: string;
  reason?: string;
  lastRequestedAt?: string;
  lastUpdatedAt?: string;
  lastResult?: string;
  lastError?: string;
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

export interface OpenClawLiveActivity {
  ts: string;
  eventType: string;
  summary: string;
  runId: string;
  agentId: string;
}

export interface OpenClawTelemetryStateView {
  transport: "poll" | "push" | "hybrid";
  ingestEndpoint: string;
  streamEndpoint: string;
  activePairings: number;
  totalPairings: number;
  eventsStored: number;
  latestEventAt?: string;
  lastIngestAt?: string;
  requestsAccepted: number;
  requestsRejected: number;
  dedupedEvents: number;
}

export interface OpenClawPairingCommands {
  powershell: string[];
  bash: string[];
}

export interface OpenClawPairingView {
  pairingId: string;
  label: string;
  userId: string;
  userEmail: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  active: boolean;
}

export interface OpenClawTelemetryEventRow {
  id: string;
  pairingId: string;
  workspaceId: string;
  userId: string;
  userEmail: string;
  sessionId?: string;
  runId: string;
  agentId: string;
  taskId?: string;
  eventType: string;
  status: "ok" | "degraded" | "failed" | "stopped" | "waiting";
  message: string;
  timestamp: string;
  source: "openclaw-hook" | "openclaw-plugin" | "openclaw-tool";
  severity: "info" | "low" | "medium" | "high" | "critical";
  confidence: number;
  metadata: Record<string, unknown>;
  signatureVersion: "v1";
  ingestedAt: string;
}

export interface OpenClawLiveView {
  connectionStatus: "connected" | "degraded" | "offline";
  statusMessage: string;
  dashboardUrl: string;
  apiBaseUrl: string;
  gatewayCommand: string;
  dashboardCommand: string;
  statusCommand: string;
  restartCommand?: string;
  currentAgentId?: string;
  currentRunId?: string;
  currentTask?: string;
  currentObjective?: string;
  lastEventAt?: string;
  runtime: {
    enabled: boolean;
    mode: "hybrid" | "log_only" | "rpc_only";
    transport: "gateway_cli" | "event_feed";
    endpoint?: string;
    cliCommand?: string;
    cliTimeoutMs: number;
    lastSyncAt?: string;
    lastError?: string;
    lastEventCount: number;
  };
  sourceHealth: {
    totalConfigured: number;
    existing: string[];
    missing: string[];
    directories: string[];
  };
  operations: {
    gateway?: Record<string, unknown>;
    status?: Record<string, unknown>;
    health?: Record<string, unknown>;
    recentLogMeta?: Record<string, unknown>;
    emergencyState?: EmergencySafetyState;
  };
  telemetry: OpenClawTelemetryStateView;
  recentActivity: OpenClawLiveActivity[];
  reconnectHints: string[];
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
  agentNetwork: AgentNetworkSnapshot;
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
  notificationCenter: NotificationCenterData;
  workflowCandidates: WorkflowCandidateRow[];
  workflowReport: WorkflowReleaseGateSummary;
  workflowPolicy: WorkflowPolicyView;
  openClawLive: OpenClawLiveView;
  ingestSummary: {
    latestEventCount: number;
    latestMemoryObjects: number;
    latestMemoryVersions: number;
  };
}
