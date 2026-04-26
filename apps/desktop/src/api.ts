import { mockData } from "./mock-data";
import type { DashboardData } from "./types";

const DEFAULT_BASE_URL = "http://localhost:4318";

function coreBaseUrl(): string {
  return import.meta.env.VITE_THEIA_CORE_URL ?? DEFAULT_BASE_URL;
}

function operatorId(): string {
  return import.meta.env.VITE_THEIA_OPERATOR_ID ?? "owner@theia";
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (typeof body.message === "string" && body.message.trim().length > 0) {
      return body.message;
    }
  } catch {
    // no-op
  }
  return `Request failed (${response.status})`;
}

async function postJson<TResponse>(path: string, body: Record<string, unknown>): Promise<TResponse> {
  const response = await fetch(`${coreBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as TResponse;
}

export async function loadDashboardData(): Promise<DashboardData> {
  const baseUrl = coreBaseUrl();

  try {
    const [runsRes, memoryRes, auditRes, connectorsRes, workflowRes, workflowReportRes, workflowPolicyRes] = await Promise.all([
      fetch(`${baseUrl}/runs`),
      fetch(`${baseUrl}/memory`),
      fetch(`${baseUrl}/audit`),
      fetch(`${baseUrl}/connectors/health`),
      fetch(`${baseUrl}/workflows`),
      fetch(`${baseUrl}/workflows/release-gates/report`),
      fetch(`${baseUrl}/workflows/policy`)
    ]);

    if (!runsRes.ok || !memoryRes.ok || !auditRes.ok || !connectorsRes.ok || !workflowRes.ok || !workflowReportRes.ok || !workflowPolicyRes.ok) {
      return mockData;
    }

    const runs = (await runsRes.json()) as Array<{ runId: string; objective: string; status: string; agentId: string }>;
    const memory = (await memoryRes.json()) as {
      objects: Array<{ memoryId: string; sourcePath: string; sectionKey: string; latestVersionId: string }>;
    };
    const audit = (await auditRes.json()) as Array<{
      timestamp: string;
      actorId: string;
      action: string;
      targetType: string;
      targetId: string;
    }>;
    const connectors = (await connectorsRes.json()) as Array<{
      connectorId: string;
      name: string;
      health: { status: "healthy" | "degraded" | "offline"; lastSuccessfulPollAt?: string };
    }>;
    const workflowCandidates = (await workflowRes.json()) as Array<{
      workflowId: string;
      title: string;
      status: "candidate" | "pending_review" | "promoted" | "rejected" | "rolled_back" | "retired" | "expired";
      impactLevel: "info" | "low" | "medium" | "high" | "critical";
      namespace: { tenantId?: string; domain: string; taskFamily: string };
      gateMetrics: {
        confidenceScore: number;
        utilityRate: number;
        overlapRate: number;
        contradictionRate: number;
        staleUseRate: number;
      };
      conflictWithWorkflowIds: string[];
      updatedAt: string;
    }>;
    const workflowReport = (await workflowReportRes.json()) as {
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
    };
    const workflowPolicy = (await workflowPolicyRes.json()) as DashboardData["workflowPolicy"];

    const healthyConnectors = connectors.filter((connector) => connector.health.status === "healthy").length;
    const connectorHealthPct =
      connectors.length === 0 ? 100 : Math.round((healthyConnectors / Math.max(1, connectors.length)) * 100);
    const promotedRate =
      workflowReport.totalCandidates === 0
        ? 0
        : Math.round((workflowReport.promotedCandidates / workflowReport.totalCandidates) * 100);

    return {
      ...mockData,
      metrics: [
        { label: "Active Runs", value: `${runs.filter((run) => run.status === "running").length}` },
        { label: "Open Alerts", value: `${mockData.alerts.filter((alert) => alert.status === "open").length}` },
        { label: "Workflow Promotions", value: `${promotedRate}%`, trend: `${workflowReport.promotedCandidates} promoted` },
        { label: "Connector Health", value: `${connectorHealthPct}%` }
      ],
      timeline: runs.slice(0, 6).map((run, index) => ({
        eventId: `run-${run.runId}`,
        ts: new Date(Date.now() - index * 60000).toISOString(),
        eventType: `run.${run.status}`,
        agent: run.agentId,
        summary: run.objective
      })),
      memory: memory.objects.slice(0, 10).map((item, index) => ({
        ...item,
        updatedAt: new Date(Date.now() - index * 120000).toISOString()
      })),
      audit: audit.slice(0, 15).map((entry) => ({
        ts: entry.timestamp,
        actor: entry.actorId,
        action: entry.action,
        target: `${entry.targetType}:${entry.targetId}`,
        result: "logged"
      })),
      connectors: connectors.map((connector) => ({
        connectorId: connector.connectorId,
        scope: connector.name,
        status: connector.health.status,
        lastSync: connector.health.lastSuccessfulPollAt ?? new Date().toISOString()
      })),
      workflowCandidates: workflowCandidates.map((candidate) => ({
        workflowId: candidate.workflowId,
        title: candidate.title,
        status: candidate.status,
        impactLevel: candidate.impactLevel,
        namespace: `tenant:${candidate.namespace.tenantId ?? "local"} / ${candidate.namespace.domain} / ${candidate.namespace.taskFamily}`,
        confidenceScore: candidate.gateMetrics.confidenceScore,
        utilityRate: candidate.gateMetrics.utilityRate,
        overlapRate: candidate.gateMetrics.overlapRate,
        contradictionRate: candidate.gateMetrics.contradictionRate,
        staleUseRate: candidate.gateMetrics.staleUseRate,
        conflictCount: candidate.conflictWithWorkflowIds.length,
        updatedAt: candidate.updatedAt
      })),
      workflowReport,
      workflowPolicy
    };
  } catch {
    return mockData;
  }
}

export async function approveWorkflowCandidate(workflowId: string, reason?: string): Promise<void> {
  await postJson(`/workflows/${encodeURIComponent(workflowId)}/review`, {
    approved: true,
    actorId: operatorId(),
    reason: reason ?? "Approved in Theia desktop governance view.",
    humanApprovalProvided: true
  });
}

export async function rejectWorkflowCandidate(workflowId: string, reason?: string): Promise<void> {
  await postJson(`/workflows/${encodeURIComponent(workflowId)}/review`, {
    approved: false,
    actorId: operatorId(),
    reason: reason ?? "Rejected in Theia desktop governance view.",
    humanApprovalProvided: true
  });
}

export async function rollbackWorkflowCandidate(workflowId: string, reason: string): Promise<void> {
  await postJson(`/workflows/${encodeURIComponent(workflowId)}/rollback`, {
    actorId: operatorId(),
    reason
  });
}

export async function retireStaleWorkflowCandidates(maxAgeDays: number): Promise<number> {
  const retired = await postJson<Array<{ workflowId: string }>>("/workflows/retire-stale", {
    maxAgeDays,
    actorId: operatorId()
  });

  return retired.length;
}

export async function updateWorkflowPromotionPolicy(policy: DashboardData["workflowPolicy"]): Promise<void> {
  const response = await fetch(`${coreBaseUrl()}/workflows/policy`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...policy,
      actorId: operatorId()
    })
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}
