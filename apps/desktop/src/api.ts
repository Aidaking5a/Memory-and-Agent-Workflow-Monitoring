import { mockData } from "./mock-data";
import type { DashboardData } from "./types";

export async function loadDashboardData(): Promise<DashboardData> {
  const baseUrl = import.meta.env.VITE_THEIA_CORE_URL ?? "http://localhost:4318";

  try {
    const [runsRes, memoryRes, auditRes, connectorsRes] = await Promise.all([
      fetch(`${baseUrl}/runs`),
      fetch(`${baseUrl}/memory`),
      fetch(`${baseUrl}/audit`),
      fetch(`${baseUrl}/connectors/health`)
    ]);

    if (!runsRes.ok || !memoryRes.ok || !auditRes.ok || !connectorsRes.ok) {
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

    const healthyConnectors = connectors.filter((connector) => connector.health.status === "healthy").length;
    const connectorHealthPct =
      connectors.length === 0 ? 100 : Math.round((healthyConnectors / Math.max(1, connectors.length)) * 100);

    return {
      ...mockData,
      metrics: [
        { label: "Active Runs", value: `${runs.filter((run) => run.status === "running").length}` },
        ...mockData.metrics.slice(1, 3),
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
      }))
    };
  } catch {
    return mockData;
  }
}
