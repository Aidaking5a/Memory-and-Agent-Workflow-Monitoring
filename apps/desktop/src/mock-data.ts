import type { DashboardData } from "./types";

export const mockData: DashboardData = {
  workspaceName: "Theia Design Partner Workspace",
  timeRange: "Last 24 hours",
  metrics: [
    { label: "Active Agents", value: "6", trend: "+1" },
    { label: "Open Alerts", value: "9", trend: "-2" },
    { label: "Memory Revisions", value: "34", trend: "+8" },
    { label: "Connector Health", value: "98%", trend: "+1.2%" }
  ],
  agents: [
    {
      agentId: "agt_alpha",
      name: "Alpha Operator",
      status: "running",
      activeRunId: "run_5481",
      riskScore: 0.31,
      staleMemoryCount: 1,
      openAlerts: 2
    },
    {
      agentId: "agt_beta",
      name: "Beta Analyst",
      status: "blocked",
      activeRunId: "run_5482",
      riskScore: 0.72,
      staleMemoryCount: 3,
      openAlerts: 4
    },
    {
      agentId: "agt_gamma",
      name: "Gamma Reviewer",
      status: "completed",
      activeRunId: "run_5479",
      riskScore: 0.12,
      staleMemoryCount: 0,
      openAlerts: 1
    }
  ],
  timeline: [
    {
      eventId: "evt_1001",
      ts: "2026-04-25T08:10:00Z",
      eventType: "run.started",
      agent: "Alpha Operator",
      summary: "Started run to reconcile memory and produce deployment recommendation"
    },
    {
      eventId: "evt_1002",
      ts: "2026-04-25T08:12:00Z",
      eventType: "memory.changed",
      agent: "Alpha Operator",
      summary: "memory.md updated in section deployment assumptions"
    },
    {
      eventId: "evt_1003",
      ts: "2026-04-25T08:15:00Z",
      eventType: "reasoning.conclusion",
      agent: "Beta Analyst",
      summary: "Concluded rollout readiness without citing latest tool output"
    }
  ],
  memory: [
    {
      memoryId: "memory_memory-md_1-deployment-assumptions",
      sourcePath: "/workspace/memory.md",
      sectionKey: "1:deployment-assumptions",
      latestVersionId: "ver_81cc10",
      updatedAt: "2026-04-25T08:12:00Z"
    },
    {
      memoryId: "memory_bootstrap-md_2-risk-controls",
      sourcePath: "/workspace/bootstrap.md",
      sectionKey: "2:risk-controls",
      latestVersionId: "ver_84aa13",
      updatedAt: "2026-04-25T07:59:00Z"
    }
  ],
  alerts: [
    {
      alertId: "alert_1",
      category: "evidence_gap",
      severity: "high",
      confidence: 0.84,
      title: "Evidence gap before conclusion",
      explanation: "Conclusion was generated without linking tool output created two minutes earlier.",
      runId: "run_5482",
      status: "open"
    },
    {
      alertId: "alert_2",
      category: "stale_memory",
      severity: "medium",
      confidence: 0.78,
      title: "Potential stale-memory dependence",
      explanation: "Decision referenced memory version ver_73ab when ver_81cc10 is now latest.",
      runId: "run_5481",
      status: "acknowledged"
    }
  ],
  comparison: [
    { metric: "Completion Rate", alphaAgent: "91%", betaAgent: "82%" },
    { metric: "Median Alert Confidence", alphaAgent: "0.55", betaAgent: "0.73" },
    { metric: "Tool Match Accuracy", alphaAgent: "97%", betaAgent: "88%" }
  ],
  audit: [
    {
      ts: "2026-04-25T08:01:00Z",
      actor: "owner@theia",
      action: "permission.grant",
      target: "connector:local-file-main",
      result: "allowed"
    },
    {
      ts: "2026-04-25T08:19:00Z",
      actor: "operator@theia",
      action: "approval.request",
      target: "privileged_action:sync_export",
      result: "pending"
    }
  ],
  connectors: [
    {
      connectorId: "local-file-main",
      scope: "memory.md, bootstrap.md",
      status: "healthy",
      lastSync: "2026-04-25T08:21:00Z"
    },
    {
      connectorId: "agent-run-stream",
      scope: "run events + tool traces",
      status: "degraded",
      lastSync: "2026-04-25T08:20:00Z"
    }
  ]
};