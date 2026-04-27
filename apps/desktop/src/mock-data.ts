import type { DashboardData } from "./types";

const now = new Date().toISOString();

export const emptyDashboardData: DashboardData = {
  generatedAt: now,
  workspaceId: "ws_local_default",
  workspaceName: "Theia Local Workspace",
  timeRange: "Last 12 hours",
  connection: {
    connected: false,
    connectionMethod: "unknown",
    discoveredSources: {
      codexLogPaths: [],
      customJsonLogPaths: [],
      openClawLogPaths: []
    },
    permissions: {
      workspaceAccessGranted: false,
      readMemoryFiles: false,
      readWorkflowEvents: false,
      readPrompts: false
    },
    health: {
      status: "offline",
      checks: [
        {
          id: "api",
          label: "Local Core Connectivity",
          status: "fail",
          detail: "Theia local-core is unreachable. Start local-core to connect this dashboard."
        }
      ]
    },
    runtime: {
      enabled: false,
      mode: "hybrid",
      hasApiKey: false,
      lastEventCount: 0
    }
  },
  operator: {
    role: "owner",
    actorId: "owner@theia",
    capabilities: [
      "setup:write",
      "plugin:write",
      "alert:write",
      "workflow:review",
      "workflow:rollback",
      "workflow:retire",
      "workflow:policy:write"
    ]
  },
  metrics: [],
  runs: [],
  agents: [],
  timeline: [],
  memory: [],
  memoryDocuments: [],
  memoryChanges: [],
  memoryImpactLinks: [],
  alerts: [],
  tokenSeries: [],
  workloadSeries: [],
  comparison: [],
  audit: [],
  connectors: [],
  plugins: [],
  workflowCandidates: [],
  workflowReport: {
    totalCandidates: 0,
    promotedCandidates: 0,
    pendingReviewCandidates: 0,
    rejectedCandidates: 0,
    rolledBackCandidates: 0,
    conflictOpenCount: 0,
    avgConfidenceScore: 0,
    avgUtilityRate: 0,
    avgContradictionRate: 0,
    avgStaleUseRate: 0
  },
  workflowPolicy: {
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
  },
  ingestSummary: {
    latestEventCount: 0,
    latestMemoryObjects: 0,
    latestMemoryVersions: 0
  }
};
