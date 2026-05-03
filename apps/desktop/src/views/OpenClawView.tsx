import { useEffect, useMemo, useState } from "react";
import {
  createOpenClawPairing,
  listOpenClawPairings,
  loadOpenClawTelemetryHistory,
  restartGateway,
  revokeOpenClawPairing,
  triggerEmergencyStop
} from "../api";
import type { DashboardData, OpenClawPairingView, OpenClawTelemetryEventRow } from "../types";

interface OpenClawViewProps {
  data: DashboardData;
  onOpenSetup: () => void;
  onRefresh: () => Promise<void>;
  streamStatus: "idle" | "connecting" | "live" | "error";
  streamMessage?: string;
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

function formatDate(value?: string): string {
  if (!value) return "n/a";
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return value;
  return ts.toLocaleString();
}

function streamLabel(status: OpenClawViewProps["streamStatus"]): string {
  if (status === "live") return "live";
  if (status === "connecting") return "connecting";
  if (status === "error") return "error";
  return "idle";
}

export function OpenClawView({ data, onOpenSetup, onRefresh, streamStatus, streamMessage }: OpenClawViewProps) {
  const [stopReason, setStopReason] = useState("Manual emergency stop requested by operator.");
  const [confirmStop, setConfirmStop] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingLabel, setPairingLabel] = useState("OpenClaw terminal pairing");
  const [pairingTtlHours, setPairingTtlHours] = useState(24);
  const [pairings, setPairings] = useState<OpenClawPairingView[]>([]);
  const [telemetryRows, setTelemetryRows] = useState<OpenClawTelemetryEventRow[]>([]);
  const [pairingToken, setPairingToken] = useState<string | undefined>(undefined);
  const [pairingCommands, setPairingCommands] = useState<{ powershell: string[]; bash: string[] } | undefined>(undefined);
  const [showRaw, setShowRaw] = useState(false);
  const [loadingOpsData, setLoadingOpsData] = useState(false);

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
  const streamStatusLabel = streamLabel(streamStatus);
  const rawAllowed = data.operator.role === "owner" || data.operator.role === "operator" || data.operator.role === "reviewer";

  const activePairings = useMemo(() => pairings.filter((entry) => entry.active), [pairings]);

  async function loadOpsData(): Promise<void> {
    setLoadingOpsData(true);
    try {
      const [pairingPayload, history] = await Promise.all([listOpenClawPairings(), loadOpenClawTelemetryHistory(120)]);
      setPairings(pairingPayload.pairings ?? []);
      setTelemetryRows(history ?? []);
    } catch (opsError) {
      setError(opsError instanceof Error ? opsError.message : "Unable to load OpenClaw telemetry details.");
    } finally {
      setLoadingOpsData(false);
    }
  }

  useEffect(() => {
    void loadOpsData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshAll(): Promise<void> {
    await Promise.all([onRefresh(), loadOpsData()]);
  }

  async function executeEmergencyStop(): Promise<void> {
    setActionBusy(true);
    setError(undefined);
    setFeedback(undefined);
    try {
      await triggerEmergencyStop(stopReason.trim() || "Emergency stop requested by operator.");
      setConfirmStop(false);
      setFeedback("Emergency stop executed. Gateway and automation are now halted until restart.");
      await refreshAll();
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
      await refreshAll();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Gateway restart failed.");
    } finally {
      setActionBusy(false);
    }
  }

  async function executeCreatePairing(): Promise<void> {
    setPairingBusy(true);
    setError(undefined);
    setFeedback(undefined);
    try {
      const created = await createOpenClawPairing({
        label: pairingLabel.trim() || "OpenClaw terminal pairing",
        ttlHours: pairingTtlHours
      });
      setPairingToken(created.token);
      setPairingCommands(created.commands);
      setFeedback("Pairing token issued. Save it now, then run the pairing command in your OpenClaw terminal.");
      await loadOpsData();
    } catch (pairingError) {
      setError(pairingError instanceof Error ? pairingError.message : "Unable to create pairing.");
    } finally {
      setPairingBusy(false);
    }
  }

  async function executeRevokePairing(pairingId: string): Promise<void> {
    setPairingBusy(true);
    setError(undefined);
    setFeedback(undefined);
    try {
      await revokeOpenClawPairing(pairingId);
      setFeedback("Pairing revoked successfully.");
      await loadOpsData();
    } catch (pairingError) {
      setError(pairingError instanceof Error ? pairingError.message : "Unable to revoke pairing.");
    } finally {
      setPairingBusy(false);
    }
  }

  return (
    <section className="view">
      <article className="panel">
        <div className="panel-header-row">
          <div>
            <h3>OpenClaw Operations Center</h3>
            <p className="muted-note">
              Dedicated OpenClaw operations surface with authenticated push telemetry, pairing controls, gateway safety
              controls, and live workflow feedback.
            </p>
          </div>
          <div className="action-group">
            <button className="action-btn neutral" type="button" onClick={onOpenSetup}>
              Open Setup
            </button>
            <button className="action-btn neutral" type="button" onClick={() => void refreshAll()} disabled={actionBusy || loadingOpsData}>
              Refresh
            </button>
          </div>
        </div>
        <div className="stat-grid-compact">
          <div className="stat-chip">
            <span>Connection</span>
            <strong>{live.connectionStatus}</strong>
          </div>
          <div className="stat-chip">
            <span>Stream</span>
            <strong>{streamStatusLabel}</strong>
          </div>
          <div className="stat-chip">
            <span>Telemetry Transport</span>
            <strong>{live.telemetry.transport}</strong>
          </div>
          <div className="stat-chip">
            <span>Active Pairings</span>
            <strong>{live.telemetry.activePairings}</strong>
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
            <span>Telemetry Events Stored</span>
            <strong>{live.telemetry.eventsStored}</strong>
          </div>
          <div className="stat-chip">
            <span>Runtime Events (last poll)</span>
            <strong>{runtime.lastEventCount}</strong>
          </div>
        </div>
        <p className="muted-note" style={{ marginTop: "0.7rem" }}>
          {live.statusMessage}
        </p>
        {streamMessage ? <p className="muted-note">Live stream: {streamMessage}</p> : null}
      </article>

      <article className="panel">
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
            <p className="muted-note">This action halts OpenClaw automation immediately. It does not auto-restart.</p>
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
      </article>

      <div className="panel-grid">
        <article className="panel">
          <h3>OpenClaw Terminal Pairing</h3>
          <p className="muted-note">
            Generate a short-lived pairing token, then run the command in your OpenClaw terminal or plugin/hook setup.
          </p>
          <label className="field-col">
            <span>Pairing label</span>
            <input value={pairingLabel} onChange={(event) => setPairingLabel(event.currentTarget.value)} maxLength={80} />
          </label>
          <label className="field-col">
            <span>Token TTL (hours)</span>
            <input
              type="number"
              min={1}
              max={168}
              value={pairingTtlHours}
              onChange={(event) => setPairingTtlHours(Math.max(1, Math.min(168, Number(event.currentTarget.value) || 24)))}
            />
          </label>
          <div className="action-group" style={{ marginTop: "0.55rem" }}>
            <button className="action-btn primary" type="button" onClick={() => void executeCreatePairing()} disabled={pairingBusy}>
              {pairingBusy ? "Creating..." : "Create Pairing Token"}
            </button>
          </div>
          {pairingToken ? (
            <div className="panel" style={{ marginTop: "0.6rem" }}>
              <h4>Latest Pairing Token (copy now)</h4>
              <code className="token-block">{pairingToken}</code>
              {pairingCommands?.powershell?.length ? (
                <>
                  <p className="muted-note">PowerShell setup</p>
                  <pre className="json-block">{pairingCommands.powershell.join("\n")}</pre>
                </>
              ) : null}
              {pairingCommands?.bash?.length ? (
                <>
                  <p className="muted-note">Bash setup</p>
                  <pre className="json-block">{pairingCommands.bash.join("\n")}</pre>
                </>
              ) : null}
            </div>
          ) : null}
        </article>

        <article className="panel">
          <h3>Pairing Status</h3>
          <ul className="dense-list">
            <li>Active pairings: {activePairings.length}</li>
            <li>Total pairings: {pairings.length}</li>
            <li>Latest ingest: {formatDate(live.telemetry.lastIngestAt)}</li>
            <li>Latest event: {formatDate(live.telemetry.latestEventAt)}</li>
            <li>Accepted requests: {live.telemetry.requestsAccepted}</li>
            <li>Rejected requests: {live.telemetry.requestsRejected}</li>
            <li>Deduped events: {live.telemetry.dedupedEvents}</li>
          </ul>
          <p className="muted-note">Ingest endpoint: {live.telemetry.ingestEndpoint}</p>
          <p className="muted-note">Stream endpoint: {live.telemetry.streamEndpoint}</p>
        </article>
      </div>

      <article className="panel">
        <h3>OpenClaw Pairings</h3>
        {pairings.length === 0 ? (
          <p className="muted-note">No pairings yet. Create a token to connect OpenClaw terminal reporting.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>User</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Last Used</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pairings.map((row) => (
                  <tr key={row.pairingId}>
                    <td>{row.label}</td>
                    <td>{row.userEmail}</td>
                    <td>{formatDate(row.createdAt)}</td>
                    <td>{formatDate(row.expiresAt)}</td>
                    <td>{formatDate(row.lastUsedAt)}</td>
                    <td>{row.active ? "active" : "inactive"}</td>
                    <td>
                      {row.active ? (
                        <button
                          type="button"
                          className="action-btn danger"
                          disabled={pairingBusy}
                          onClick={() => void executeRevokePairing(row.pairingId)}
                        >
                          Revoke
                        </button>
                      ) : (
                        <span className="muted-note">n/a</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
              <p className="muted-note">Missing sources are degraded but suppressed from repetitive run failure noise.</p>
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

      <article className="panel">
        <h3>Push Telemetry Event Log</h3>
        {loadingOpsData ? (
          <p className="muted-note">Loading telemetry history...</p>
        ) : telemetryRows.length === 0 ? (
          <p className="muted-note">No pushed OpenClaw telemetry yet. Use pairing token commands to start reporting.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Agent</th>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {telemetryRows.slice(0, 24).map((row) => (
                  <tr key={`${row.id}-${row.timestamp}`}>
                    <td>{formatDate(row.timestamp)}</td>
                    <td>{row.eventType}</td>
                    <td>{row.agentId}</td>
                    <td>{row.runId}</td>
                    <td>{row.status}</td>
                    <td>{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

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
          {!rawAllowed ? (
            <p className="muted-note">Raw telemetry traces are restricted to owner/operator/reviewer roles.</p>
          ) : (
            <>
              <label className="field-check">
                <input type="checkbox" checked={showRaw} onChange={(event) => setShowRaw(event.currentTarget.checked)} />
                <span>Show raw gateway/status health JSON (advanced)</span>
              </label>
              {showRaw ? (
                <>
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
                </>
              ) : (
                <p className="muted-note">Enable the advanced toggle to inspect raw diagnostics.</p>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  );
}
