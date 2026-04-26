import type { DashboardData } from "../types";
import { MetricCard } from "../components/MetricCard";

export function OverviewView({ data }: { data: DashboardData }) {
  const openAlerts = data.alerts.filter((alert) => alert.status === "open");
  const criticalAlerts = openAlerts.filter((alert) => alert.severity === "high" || alert.severity === "critical").length;
  const highestRiskAgent = [...data.agents].sort((a, b) => b.riskScore - a.riskScore)[0];
  const staleMemoryAgent = [...data.agents].sort((a, b) => b.staleMemoryCount - a.staleMemoryCount)[0];
  const openClawConnector = data.connectors.find((connector) =>
    `${connector.connectorId} ${connector.scope}`.toLowerCase().includes("openclaw")
  );

  const actionItems = [
    criticalAlerts > 0
      ? `${criticalAlerts} high-severity alerts need immediate review.`
      : "No high-severity alerts are currently open.",
    data.workflowReport.pendingReviewCandidates > 0
      ? `${data.workflowReport.pendingReviewCandidates} workflows are waiting for governance approval.`
      : "Workflow promotion queue is clear.",
    staleMemoryAgent && staleMemoryAgent.staleMemoryCount > 0
      ? `${staleMemoryAgent.name} has ${staleMemoryAgent.staleMemoryCount} stale-memory references.`
      : "No stale-memory hotspots detected."
  ];

  return (
    <section className="view">
      <div className="metrics-grid">
        {data.metrics.map((metric) => (
          <MetricCard key={metric.label} label={metric.label} value={metric.value} trend={metric.trend} />
        ))}
      </div>
      <div className="focus-grid">
        <article className="focus-card">
          <p>Critical Alert Load</p>
          <h3>{criticalAlerts}</h3>
          <span>{openAlerts.length} open reasoning alerts</span>
        </article>
        <article className="focus-card">
          <p>Highest Agent Risk</p>
          <h3>{highestRiskAgent ? `${Math.round(highestRiskAgent.riskScore * 100)}%` : "N/A"}</h3>
          <span>{highestRiskAgent ? highestRiskAgent.name : "No active agents"}</span>
        </article>
        <article className="focus-card">
          <p>OpenClaw Stream</p>
          <h3>{openClawConnector ? "Connected" : "Not Connected"}</h3>
          <span>{openClawConnector ? openClawConnector.status : "Set THEIA_OPENCLAW_LOG_SOURCES"}</span>
        </article>
      </div>
      <div className="panel-grid">
        <article className="panel">
          <h3>Operator Priority Board</h3>
          <p>
            Focused workload summary across memory quality, workflow governance, and connector integrity.
          </p>
          <ol className="action-list">
            {actionItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </article>
        <article className="panel">
          <h3>Governance Snapshot</h3>
          <ul>
            <li>Promoted workflows: {data.workflowReport.promotedCandidates}</li>
            <li>Pending governance reviews: {data.workflowReport.pendingReviewCandidates}</li>
            <li>Compatibility conflicts: {data.workflowReport.conflictOpenCount}</li>
            <li>Average contradiction rate: {Math.round(data.workflowReport.avgContradictionRate * 100)}%</li>
          </ul>
        </article>
      </div>
    </section>
  );
}
