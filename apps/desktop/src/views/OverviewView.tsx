import { useMemo, useState } from "react";
import type { DashboardData } from "../types";
import { MetricCard } from "../components/MetricCard";

function maxOf(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

export function OverviewView({ data, onOpenClawOps }: { data: DashboardData; onOpenClawOps: () => void }) {
  const openAlerts = data.alerts.filter((alert) => alert.status === "open");
  const criticalAlerts = openAlerts.filter((alert) => alert.severity === "high" || alert.severity === "critical").length;
  const highestRiskAgent = [...data.agents].sort((a, b) => b.riskScore - a.riskScore)[0];
  const highestBurnAgent = [...data.agents].sort((a, b) => b.tokens24h - a.tokens24h)[0];
  const tokenMax = Math.max(1, maxOf(data.tokenSeries.map((point) => point.totalTokens)));
  const workloadMax = Math.max(1, maxOf(data.workloadSeries.map((point) => point.events)));
  const [tokenFocusIndex, setTokenFocusIndex] = useState(Math.max(0, data.tokenSeries.length - 1));
  const [workloadFocusIndex, setWorkloadFocusIndex] = useState(Math.max(0, data.workloadSeries.length - 1));
  const openClawLive = data.openClawLive;

  const tokenFocus = useMemo(
    () => (data.tokenSeries.length > 0 ? data.tokenSeries[Math.min(tokenFocusIndex, data.tokenSeries.length - 1)] : undefined),
    [data.tokenSeries, tokenFocusIndex]
  );
  const workloadFocus = useMemo(
    () =>
      data.workloadSeries.length > 0
        ? data.workloadSeries[Math.min(workloadFocusIndex, data.workloadSeries.length - 1)]
        : undefined,
    [data.workloadSeries, workloadFocusIndex]
  );

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

      <article className="panel">
        <div className="panel-header-row">
          <h3>OpenClaw Runtime Snapshot</h3>
          <button className="action-btn neutral" type="button" onClick={onOpenClawOps}>
            Open Operations Center
          </button>
        </div>
        <p className="muted-note">
          {openClawLive.statusMessage} Last update:{" "}
          {openClawLive.lastEventAt ? new Date(openClawLive.lastEventAt).toLocaleString() : "waiting for activity"}.
        </p>
        <div className="stat-grid-compact">
          <div className="stat-chip">
            <span>Connection</span>
            <strong>{openClawLive.connectionStatus}</strong>
          </div>
          <div className="stat-chip">
            <span>Current Agent</span>
            <strong>{openClawLive.currentAgentId ?? "n/a"}</strong>
          </div>
          <div className="stat-chip">
            <span>Current Run</span>
            <strong>{openClawLive.currentRunId ?? "n/a"}</strong>
          </div>
          <div className="stat-chip">
            <span>Transport</span>
            <strong>{openClawLive.runtime.transport}</strong>
          </div>
          <div className="stat-chip">
            <span>Runtime Events</span>
            <strong>{openClawLive.runtime.lastEventCount}</strong>
          </div>
        </div>
        <ul className="dense-list">
          <li>Current task: {openClawLive.currentTask ?? "No task extracted yet."}</li>
          <li>Objective: {openClawLive.currentObjective ?? "No active objective."}</li>
          <li>Source paths missing: {openClawLive.sourceHealth.missing.length}</li>
          <li>Gateway dashboard: {openClawLive.dashboardUrl}</li>
        </ul>
      </article>

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
            <>
              <div className="sparkline-row">
                {data.tokenSeries.map((point, index) => (
                  <div className="sparkline-col" key={point.bucket}>
                    <button
                      className="sparkline-btn"
                      type="button"
                      onMouseEnter={() => setTokenFocusIndex(index)}
                      onFocus={() => setTokenFocusIndex(index)}
                      onClick={() => setTokenFocusIndex(index)}
                    >
                      <span
                        className={`sparkline-bar red${tokenFocus?.bucket === point.bucket ? " active" : ""}`}
                        style={{ height: `${Math.max(8, Math.round((point.totalTokens / tokenMax) * 110))}px` }}
                        title={`${point.label}: ${point.totalTokens.toLocaleString()} tokens`}
                      />
                    </button>
                    <small>{point.label}</small>
                  </div>
                ))}
              </div>
              {tokenFocus ? (
                <p className="chart-inspect-note">
                  {tokenFocus.label}: {tokenFocus.totalTokens.toLocaleString()} total tokens ({tokenFocus.promptTokens.toLocaleString()} prompt /{" "}
                  {tokenFocus.completionTokens.toLocaleString()} completion)
                </p>
              ) : null}
            </>
          )}
        </article>
      </div>

      <div className="panel-grid">
        <article className="panel">
          <h3>Workload Activity (Last 12h)</h3>
          {data.workloadSeries.length === 0 ? (
            <p className="muted-note">No event stream activity detected yet.</p>
          ) : (
            <>
              <div className="sparkline-row">
                {data.workloadSeries.map((point, index) => (
                  <div className="sparkline-col" key={point.bucket}>
                    <button
                      className="sparkline-btn"
                      type="button"
                      onMouseEnter={() => setWorkloadFocusIndex(index)}
                      onFocus={() => setWorkloadFocusIndex(index)}
                      onClick={() => setWorkloadFocusIndex(index)}
                    >
                      <span
                        className={`sparkline-bar dark${workloadFocus?.bucket === point.bucket ? " active" : ""}`}
                        style={{ height: `${Math.max(8, Math.round((point.events / workloadMax) * 110))}px` }}
                        title={`${point.label}: ${point.events} events`}
                      />
                    </button>
                    <small>{point.label}</small>
                  </div>
                ))}
              </div>
              {workloadFocus ? (
                <p className="chart-inspect-note">
                  {workloadFocus.label}: {workloadFocus.events} events and {workloadFocus.tokens.toLocaleString()} associated tokens
                </p>
              ) : null}
            </>
          )}
        </article>
        <article className="panel">
          <h3>Ingestion Summary</h3>
          <ul className="dense-list">
            <li>Latest events ingested: {data.ingestSummary.latestEventCount}</li>
            <li>Memory objects tracked: {data.ingestSummary.latestMemoryObjects}</li>
            <li>Memory versions tracked: {data.ingestSummary.latestMemoryVersions}</li>
            <li>Enabled plugins: {data.plugins.filter((plugin) => plugin.enabled).length}</li>
            <li>High-risk dispatch p95: {data.notificationCenter.slo.measuredP95Ms} ms</li>
          </ul>
        </article>
      </div>
    </section>
  );
}
