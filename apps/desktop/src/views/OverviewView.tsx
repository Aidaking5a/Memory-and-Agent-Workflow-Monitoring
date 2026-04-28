import type { DashboardData } from "../types";
import { MetricCard } from "../components/MetricCard";

function maxOf(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

export function OverviewView({ data }: { data: DashboardData }) {
  const openAlerts = data.alerts.filter((alert) => alert.status === "open");
  const criticalAlerts = openAlerts.filter((alert) => alert.severity === "high" || alert.severity === "critical").length;
  const highestRiskAgent = [...data.agents].sort((a, b) => b.riskScore - a.riskScore)[0];
  const highestBurnAgent = [...data.agents].sort((a, b) => b.tokens24h - a.tokens24h)[0];
  const tokenMax = Math.max(1, maxOf(data.tokenSeries.map((point) => point.totalTokens)));
  const workloadMax = Math.max(1, maxOf(data.workloadSeries.map((point) => point.events)));

  const actionItems = [
    data.connection.connected
      ? `Connected workspace: ${data.connection.workspacePath ?? "not set"}`
      : "No connected workspace. Complete OpenClaw onboarding before trusting metrics.",
    criticalAlerts > 0
      ? `${criticalAlerts} high-severity reasoning alerts require review.`
      : "No high-severity reasoning alerts currently open.",
    highestRiskAgent
      ? `${highestRiskAgent.name} risk score ${Math.round(highestRiskAgent.riskScore * 100)}% with ${highestRiskAgent.openAlerts} open alerts.`
      : "No active agent sessions detected yet.",
    data.connection.runtime.enabled
      ? `OpenClaw runtime mode ${data.connection.runtime.mode}${data.connection.runtime.lastError ? ` with warning: ${data.connection.runtime.lastError}` : " is active."}`
      : "OpenClaw runtime RPC is disabled; only file connectors are used.",
    data.workflowReport.pendingReviewCandidates > 0
      ? `${data.workflowReport.pendingReviewCandidates} workflow promotions are pending governance review.`
      : "Workflow promotion queue is clear."
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
          <p>Setup Health</p>
          <h3>{data.connection.health.status.toUpperCase()}</h3>
          <span>{data.connection.connected ? "Connected" : "Not Connected"}</span>
        </article>
        <article className="focus-card">
          <p>Highest Agent Risk</p>
          <h3>{highestRiskAgent ? `${Math.round(highestRiskAgent.riskScore * 100)}%` : "N/A"}</h3>
          <span>{highestRiskAgent ? highestRiskAgent.name : "No active agents"}</span>
        </article>
        <article className="focus-card">
          <p>Top Token Burn</p>
          <h3>{highestBurnAgent ? highestBurnAgent.tokens24h.toLocaleString() : "0"}</h3>
          <span>{highestBurnAgent ? highestBurnAgent.name : "No token telemetry yet"}</span>
        </article>
      </div>

      <div className="panel-grid">
        <article className="panel">
          <h3>Operator Priority Board</h3>
          <ol className="action-list">
            {actionItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </article>
        <article className="panel">
          <h3>Token Usage (Last 12h)</h3>
          {data.tokenSeries.length === 0 ? (
            <p className="muted-note">No token telemetry yet.</p>
          ) : (
            <div className="sparkline-row">
              {data.tokenSeries.map((point) => (
                <div className="sparkline-col" key={point.bucket}>
                  <span
                    className="sparkline-bar red"
                    style={{ height: `${Math.max(6, Math.round((point.totalTokens / tokenMax) * 110))}px` }}
                    title={`${point.label}: ${point.totalTokens.toLocaleString()} tokens`}
                  />
                  <small>{point.label}</small>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <div className="panel-grid">
        <article className="panel">
          <h3>Workload Activity (Last 12h)</h3>
          {data.workloadSeries.length === 0 ? (
            <p className="muted-note">No event stream activity detected yet.</p>
          ) : (
            <div className="sparkline-row">
              {data.workloadSeries.map((point) => (
                <div className="sparkline-col" key={point.bucket}>
                  <span
                    className="sparkline-bar dark"
                    style={{ height: `${Math.max(6, Math.round((point.events / workloadMax) * 110))}px` }}
                    title={`${point.label}: ${point.events} events`}
                  />
                  <small>{point.label}</small>
                </div>
              ))}
            </div>
          )}
        </article>
        <article className="panel">
          <h3>Ingestion Summary</h3>
          <ul className="dense-list">
            <li>Latest events ingested: {data.ingestSummary.latestEventCount}</li>
            <li>Memory objects tracked: {data.ingestSummary.latestMemoryObjects}</li>
            <li>Memory versions tracked: {data.ingestSummary.latestMemoryVersions}</li>
            <li>Enabled plugins: {data.plugins.filter((plugin) => plugin.enabled).length}</li>
          </ul>
        </article>
      </div>
    </section>
  );
}
