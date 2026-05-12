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
      transport: "gateway_cli",
      hasApiKey: false,
      cliCommand: "openclaw",
      cliTimeoutMs: 9000,
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
  agentNetwork: {
    generatedAt: now,
    workspaceId: "ws_local_default",
    workspaceName: "Theia Local Workspace",
    protocolVersion: "agent-activity/v1",
    orchestrator: {
      agentId: "agent:theia-orchestrator",
      name: "Theia Orchestrator",
      status: "idle",
      soulSummary: "Coordinate private agents through explicit links, validated telemetry, redacted summaries, and visible controls.",
      memorySummary: "No private agents registered yet.",
      telemetryEndpoint: "http://localhost:4318/agent-network/telemetry/events",
      streamEndpoint: "http://localhost:4318/agent-network/stream",
      categories: [
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
      ],
      customCategoryPattern: "^[a-z][a-z0-9_]{2,31}$"
    },
    stats: {
      activeAgents: 0,
      totalAgents: 0,
      stoppedAgents: 0,
      activeLinks: 0,
      blockedLinks: 0,
      recentEvents: 0,
      tokens: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        runtimeMs: 0,
        logBytes: 0
      },
      estimatedSpendUsd: 0,
      runtimeMs: 0,
      logBytes: 0,
      system: {
        platform: "unknown",
        arch: "unknown",
        cpus: 0,
        loadAverage: [],
        totalRamBytes: 0,
        freeRamBytes: 0,
        usedRamBytes: 0,
        processRamBytes: 0,
        uptimeSeconds: 0
      },
      perAgent: []
    },
    agents: [],
    links: [],
    events: [],
    commands: []
  },
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
  notificationCenter: {
    settings: {
      enabled: true,
      minimumSeverity: "high",
      minimumConfidence: 0.7,
      dedupeWindowSeconds: 120,
      cooldownSeconds: 90,
      antiSpamWindowSeconds: 300,
      maxNotificationsPerWindow: 14,
      channels: {
        inAppBanner: true,
        email: false,
        webhook: false
      },
      quietHours: {
        enabled: false,
        startLocal: "22:00",
        endLocal: "07:00",
        allowCritical: true
      },
      retry: {
        maxAttempts: 3,
        baseDelayMs: 350,
        maxDelayMs: 2500
      },
      routing: {
        defaultRecipients: [],
        criticalRecipients: []
      },
      escalation: {
        enabled: true,
        severityAtLeast: "critical",
        afterMinutes: 5,
        additionalRecipients: [],
        escalateToWebhook: false
      },
      email: {
        fromAddress: "alerts@theia.local",
        smtpPort: 587,
        secure: false,
        connectTimeoutMs: 7000,
        subjectPrefix: "[THEIA HIGH-RISK]",
        configured: false,
        hasPassword: false
      },
      webhook: {
        timeoutMs: 3500,
        configured: false,
        hasBearerToken: false
      },
      slo: {
        p95DispatchTargetMs: 1200
      }
    },
    taxonomy: [],
    history: [],
    pipeline: {
      detected: 0,
      dispatched: 0,
      suppressed: 0,
      suppressedBreakdown: {
        dispatched: 0,
        filtered_threshold: 0,
        suppressed_dedupe: 0,
        suppressed_cooldown: 0,
        suppressed_rate_limit: 0,
        quiet_hours: 0,
        disabled: 0
      },
      averageDetectionMs: 0,
      p95DetectionMs: 0
    },
    slo: {
      targetP95Ms: 1200,
      measuredP95Ms: 0,
      measuredP50Ms: 0,
      sampleSize: 0,
      withinTarget: true,
      queueDepth: 0,
      failedDeliveryCount24h: 0
    }
  },
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
  openClawLive: {
    connectionStatus: "offline",
    statusMessage: "OpenClaw connector is not enabled yet.",
    dashboardUrl: "http://127.0.0.1:18789/",
    apiBaseUrl: "http://localhost:18789/v1",
    gatewayCommand: "openclaw gateway --port 18789",
    dashboardCommand: "openclaw dashboard",
    statusCommand: "openclaw gateway status",
    restartCommand: "openclaw gateway start",
    runtime: {
      enabled: false,
      mode: "hybrid",
      transport: "gateway_cli",
      cliCommand: "openclaw",
      cliTimeoutMs: 9000,
      lastEventCount: 0
    },
    sourceHealth: {
      totalConfigured: 0,
      existing: [],
      missing: [],
      directories: []
    },
    operations: {
      emergencyState: {
        status: "ready",
        isStopped: false,
        stopping: false,
        restartAvailable: false
      }
    },
    telemetry: {
      transport: "poll",
      ingestEndpoint: "http://localhost:4318/openclaw/telemetry/events",
      streamEndpoint: "http://localhost:4318/openclaw/telemetry/stream",
      activePairings: 0,
      totalPairings: 0,
      eventsStored: 0,
      requestsAccepted: 0,
      requestsRejected: 0,
      dedupedEvents: 0
    },
    recentActivity: [],
    reconnectHints: [
      "Run openclaw gateway --port 18789 and confirm with openclaw gateway status.",
      "Open the dashboard with openclaw dashboard.",
      "Enable runtime endpoint in OpenClaw setup only after validating token/auth settings."
    ]
  },
  ingestSummary: {
    latestEventCount: 0,
    latestMemoryObjects: 0,
    latestMemoryVersions: 0
  }
};
