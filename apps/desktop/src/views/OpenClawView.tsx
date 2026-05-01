import { useState } from "react";
import { restartGateway, triggerEmergencyStop } from "../api";
import type { DashboardData } from "../types";

interface OpenClawViewProps {
  data: DashboardData;
  onOpenSetup: () => void;
  onRefresh: () => Promise<void>;
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

export function OpenClawView({ data, onOpenSetup, onRefresh }: OpenClawViewProps) {
  const [stopReason, setStopReason] = useState("Manual emergency stop requested by operator.");
  const [confirmStop, setConfirmStop] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const live = data.openClawLive;
  const runtime = live.runtime;
  const sourceHealth = live.sourceHealth;
  const safety = live.operations.emergencyState;
  const gateway = live.operations.gateway as Record<string, any> | undefined;
  const status = live.operations.status as Record<string, any> | undefined;
  const health = live.operations.health as Record<string, any> | undefined;
  const gatewayRpcOk = Boolean(gateway?.rpc?.ok ?? gateway?.health?.healthy);
  const sessionCount = Number(status?.sessions?.count ?? status?.agents?.totalSessions ?? 0);
  const agentCount = Array.isArray(status?.agents?.agents) ? status.agents.agents.length : 0;
  const stopDisabled = actionBusy || Boolean(safety?.stopping);
  const restartDisabled = actionBusy || !Boolean(safety?.restartAvailable);

  async function executeEmergencyStop(): Promise<void> {
    setActionBusy(true);
    setError(undefined);
    setFeedback(undefined);
    try {
      await triggerEmergencyStop(stopReason.trim() || "Emergency stop requested by operator.");
      setConfirmStop(false);
      setFeedback("Emergency stop executed. Gateway and automation are now halted until restart.");
      await onRefresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Emergency stop failed.");
    } finally {
      setActionBusy(false);
    }
  }

  async function executeRestart(): Promise<void> {
    setActionBusy(true);
    setError(undefined);
    setFeedback(undefined);
    try {
      await restartGateway(true);
      setFeedback("Gateway restart completed and runtime polling resumed.");
      await onRefresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Gateway restart failed.");
    } finally {
      setActionBusy(false);
    }
  }

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
            <button className="action-btn neutral" type="button" onClick={() => void onRefresh()} disabled={actionBusy}>
              Refresh
            </button>
          </div>
        </div>
        <div className="emergency-card" role="region" aria-label="Emergency stop controls">
          <div>
            <h4>Emergency Stop</h4>
            <p className="muted-note">
              Immediately stops OpenClaw gateway activity and disables runtime polling until manual restart.
            </p>
            <p className="muted-note">
              State: <strong>{safety?.status ?? "ready"}</strong>{" "}
              {safety?.lastUpdatedAt ? `| Updated ${new Date(safety.lastUpdatedAt).toLocaleString()}` : ""}
            </p>
          </div>
          <div className="emergency-actions">
            <button
              className="emergency-stop-btn"
              type="button"
              onClick={() => setConfirmStop(true)}
              disabled={stopDisabled || Boolean(safety?.isStopped)}
            >
              {actionBusy && confirmStop ? "Stopping..." : "Emergency Stop"}
            </button>
            <button
              className="action-btn neutral"
              type="button"
              onClick={() => void executeRestart()}
              disabled={restartDisabled}
            >
              Restart Gateway
            </button>
          </div>
        </div>
        {confirmStop ? (
          <div className="panel" style={{ marginTop: "0.65rem", borderColor: "rgba(255, 90, 95, 0.65)" }}>
            <h4>Confirm Emergency Stop</h4>
            <p className="muted-note">
              This action halts OpenClaw automation immediately. It does not auto-restart.
            </p>
            <label className="field-col">
              <span>Reason</span>
              <textarea value={stopReason} onChange={(event) => setStopReason(event.target.value)} maxLength={240} />
            </label>
            <div className="action-group" style={{ marginTop: "0.55rem" }}>
              <button className="action-btn danger" type="button" disabled={actionBusy} onClick={() => void executeEmergencyStop()}>
                Confirm Stop
              </button>
              <button className="action-btn neutral" type="button" disabled={actionBusy} onClick={() => setConfirmStop(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {feedback ? <div className="feedback success">{feedback}</div> : null}
        {error ? <div className="feedback error">{error}</div> : null}
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
            {live.restartCommand ? <code>{live.restartCommand}</code> : null}
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
