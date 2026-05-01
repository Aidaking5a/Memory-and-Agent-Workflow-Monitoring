import type { DashboardData } from "../types";

interface OpenClawViewProps {
  data: DashboardData;
  onOpenSetup: () => void;
}

function toJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function countStatusLabel(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

export function OpenClawView({ data, onOpenSetup }: OpenClawViewProps) {
  const live = data.openClawLive;
  const runtime = live.runtime;
  const sourceHealth = live.sourceHealth;
  const gateway = live.operations.gateway as Record<string, any> | undefined;
  const status = live.operations.status as Record<string, any> | undefined;
  const health = live.operations.health as Record<string, any> | undefined;
  const gatewayRpcOk = Boolean(gateway?.rpc?.ok ?? gateway?.health?.healthy);
  const sessionCount = Number(status?.sessions?.count ?? status?.agents?.totalSessions ?? 0);
  const agentCount = Array.isArray(status?.agents?.agents) ? status.agents.agents.length : 0;

  return (
    <section className="view">
      <article className="panel">
        <div className="panel-header-row">
          <div>
            <h3>OpenClaw Operations Center</h3>
            <p className="muted-note">
              Dedicated runtime and connector diagnostics for OpenClaw gateway health, session telemetry, and transcript
              ingestion.
            </p>
          </div>
          <div className="action-group">
            <button className="action-btn neutral" type="button" onClick={onOpenSetup}>
              Open Setup
            </button>
          </div>
        </div>
        <div className="stat-grid-compact">
          <div className="stat-chip">
            <span>Connection</span>
            <strong>{live.connectionStatus}</strong>
          </div>
          <div className="stat-chip">
            <span>Runtime Transport</span>
            <strong>{runtime.transport}</strong>
          </div>
          <div className="stat-chip">
            <span>Gateway RPC Probe</span>
            <strong>{gatewayRpcOk ? "ok" : "degraded"}</strong>
          </div>
          <div className="stat-chip">
            <span>Runtime Events (last poll)</span>
            <strong>{runtime.lastEventCount}</strong>
          </div>
        </div>
        <p className="muted-note" style={{ marginTop: "0.7rem" }}>
          {live.statusMessage}
        </p>
      </article>

      <div className="panel-grid">
        <article className="panel">
          <h3>Runtime Pipeline</h3>
          <ul className="dense-list">
            <li>Mode: {runtime.mode}</li>
            <li>Transport: {runtime.transport}</li>
            <li>CLI command: {runtime.cliCommand ?? "not set"}</li>
            <li>CLI timeout: {runtime.cliTimeoutMs} ms</li>
            <li>Endpoint: {runtime.endpoint ?? "not set"}</li>
            <li>Last sync: {runtime.lastSyncAt ? new Date(runtime.lastSyncAt).toLocaleString() : "not synced yet"}</li>
            <li>Last error: {runtime.lastError ?? "none"}</li>
          </ul>
          <div className="action-list-inline">
            <code>{live.gatewayCommand}</code>
            <code>{live.statusCommand}</code>
            <code>{live.dashboardCommand}</code>
          </div>
        </article>
        <article className="panel">
          <h3>Transcript Source Health</h3>
          <ul className="dense-list">
            <li>Configured sources: {sourceHealth.totalConfigured}</li>
            <li>{countStatusLabel(sourceHealth.existing.length, "file source is readable", "file sources are readable")}</li>
            <li>
              {countStatusLabel(
                sourceHealth.directories.length,
                "directory source is readable",
                "directory sources are readable"
              )}
            </li>
            <li>{countStatusLabel(sourceHealth.missing.length, "source is missing", "sources are missing")}</li>
          </ul>
          {sourceHealth.missing.length > 0 ? (
            <>
              <p className="muted-note">Missing sources are suppressed from repetitive run failure noise.</p>
              <ul className="dense-list">
                {sourceHealth.missing.slice(0, 6).map((sourcePath) => (
                  <li key={sourcePath}>{sourcePath}</li>
                ))}
              </ul>
            </>
          ) : null}
        </article>
      </div>

      <div className="panel-grid">
        <article className="panel">
          <h3>Gateway and Session Diagnostics</h3>
          <ul className="dense-list">
            <li>Gateway dashboard: {live.dashboardUrl}</li>
            <li>OpenAI-compatible API: {live.apiBaseUrl}</li>
            <li>Gateway RPC: {gatewayRpcOk ? "ok" : "not healthy"}</li>
            <li>Sessions tracked: {sessionCount}</li>
            <li>Agents discovered: {agentCount}</li>
            <li>Current agent: {live.currentAgentId ?? "n/a"}</li>
            <li>Current run: {live.currentRunId ?? "n/a"}</li>
            <li>Current task: {live.currentTask ?? "No task extracted yet."}</li>
            <li>Current objective: {live.currentObjective ?? "No active objective."}</li>
          </ul>
        </article>
        <article className="panel">
          <h3>Recent OpenClaw Activity</h3>
          {live.recentActivity.length === 0 ? (
            <p className="muted-note">No OpenClaw runtime activity detected yet.</p>
          ) : (
            <ul className="dense-list">
              {live.recentActivity.slice(0, 10).map((event) => (
                <li key={`${event.ts}-${event.runId}-${event.eventType}`}>
                  <strong>{new Date(event.ts).toLocaleTimeString()}</strong> {event.eventType} ({event.agentId}) -{" "}
                  {event.summary}
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      <div className="panel-grid">
        <article className="panel">
          <h3>Reconnect Guidance</h3>
          <ol className="action-list">
            {live.reconnectHints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ol>
        </article>
        <article className="panel">
          <h3>Raw Diagnostics</h3>
          <details className="json-details">
            <summary>Gateway status JSON</summary>
            <pre className="json-block">{toJson(gateway ?? {})}</pre>
          </details>
          <details className="json-details">
            <summary>OpenClaw status JSON</summary>
            <pre className="json-block">{toJson(status ?? {})}</pre>
          </details>
          <details className="json-details">
            <summary>OpenClaw health JSON</summary>
            <pre className="json-block">{toJson(health ?? {})}</pre>
          </details>
        </article>
      </div>
    </section>
  );
}
