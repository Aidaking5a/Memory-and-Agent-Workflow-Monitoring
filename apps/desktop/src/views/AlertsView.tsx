import { useMemo, useState } from "react";
import { updateAlertStatus, updateHighRiskNotificationStatus } from "../api";
import { SeverityBadge } from "../components/SeverityBadge";
import type { AlertItem, DashboardData, HighRiskNotificationRecord } from "../types";

interface AlertsViewProps {
  data: DashboardData;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
}

export function AlertsView({ data, onRefresh, isRefreshing }: AlertsViewProps) {
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [busyHighRiskId, setBusyHighRiskId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ level: "success" | "error"; message: string } | null>(null);
  const [q, setQ] = useState("");
  const [severityFilter, setSeverityFilter] = useState<"all" | "medium" | "high" | "critical">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "acknowledged" | "resolved">("all");
  const [channelFilter, setChannelFilter] = useState<"all" | "in_app_banner" | "email" | "webhook">("all");
  const canWrite = data.operator.capabilities.includes("alert:write");

  const filteredHighRisk = useMemo(() => {
    return data.notificationCenter.history.filter((record) => {
      if (severityFilter !== "all" && record.severity !== severityFilter) return false;
      if (statusFilter !== "all" && record.status !== statusFilter) return false;
      if (channelFilter !== "all" && !record.channels.some((channel) => channel.channel === channelFilter)) return false;
      if (!q.trim()) return true;
      const query = q.trim().toLowerCase();
      return `${record.title} ${record.explanation} ${record.agentId} ${record.runId} ${record.category}`.toLowerCase().includes(query);
    });
  }, [channelFilter, data.notificationCenter.history, q, severityFilter, statusFilter]);

  async function setStatus(alert: AlertItem, status: "open" | "acknowledged" | "dismissed" | "resolved") {
    setBusyAlertId(alert.alertId);
    setFeedback(null);
    try {
      const note = window.prompt("Optional note for alert status change:", "");
      if (note === null) {
        setBusyAlertId(null);
        return;
      }
      await updateAlertStatus(alert.alertId, status, note.trim() || undefined);
      await onRefresh();
      setFeedback({ level: "success", message: `Alert ${alert.alertId} marked as ${status}.` });
    } catch (error) {
      setFeedback({
        level: "error",
        message: error instanceof Error ? error.message : "Failed to update alert status."
      });
    } finally {
      setBusyAlertId(null);
    }
  }

  async function setHighRiskStatus(record: HighRiskNotificationRecord, status: "open" | "acknowledged" | "resolved") {
    setBusyHighRiskId(record.notificationId);
    setFeedback(null);
    try {
      await updateHighRiskNotificationStatus(record.notificationId, status);
      await onRefresh();
      setFeedback({
        level: "success",
        message: `High-risk notification ${record.notificationId} marked as ${status}.`
      });
    } catch (error) {
      setFeedback({
        level: "error",
        message: error instanceof Error ? error.message : "Failed to update high-risk notification status."
      });
    } finally {
      setBusyHighRiskId(null);
    }
  }

  return (
    <section className="view">
      <article className="panel">
        <h3>High-Risk Notification Center</h3>
        <p className="muted-note">
          Low-latency high-risk notifications with suppression reasons, channel delivery states, and traceable event context.
        </p>
        {feedback ? <p className={feedback.level === "error" ? "feedback error" : "feedback success"}>{feedback.message}</p> : null}
        {!canWrite ? <p className="muted-note">Current role is read-only for alert operations.</p> : null}

        <div className="alert-filter-grid">
          <label className="field-col">
            <span>Search</span>
            <input value={q} placeholder="Agent, run, title, category" onChange={(event) => setQ(event.currentTarget.value)} />
          </label>
          <label className="field-col">
            <span>Severity</span>
            <select value={severityFilter} onChange={(event) => setSeverityFilter(event.currentTarget.value as typeof severityFilter)}>
              <option value="all">all</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
          </label>
          <label className="field-col">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value as typeof statusFilter)}>
              <option value="all">all</option>
              <option value="open">open</option>
              <option value="acknowledged">acknowledged</option>
              <option value="resolved">resolved</option>
            </select>
          </label>
          <label className="field-col">
            <span>Channel</span>
            <select value={channelFilter} onChange={(event) => setChannelFilter(event.currentTarget.value as typeof channelFilter)}>
              <option value="all">all</option>
              <option value="in_app_banner">in_app_banner</option>
              <option value="email">email</option>
              <option value="webhook">webhook</option>
            </select>
          </label>
        </div>

        <div className="desktop-only">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Category</th>
                  <th>Agent / Run</th>
                  <th>Why It Triggered</th>
                  <th>Channels</th>
                  <th>Status</th>
                  <th>Detected</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredHighRisk.map((record) => (
                  <tr key={record.notificationId}>
                    <td>
                      <SeverityBadge severity={record.severity} />
                    </td>
                    <td>{record.category}</td>
                    <td>
                      {record.agentId}
                      <br />
                      <small>{record.runId}</small>
                    </td>
                    <td>
                      <strong>{record.title}</strong>
                      <br />
                      <small>{record.explanation}</small>
                    </td>
                    <td>
                      {record.channels.map((channel) => (
                        <div key={`${record.notificationId}:${channel.channel}`}>
                          {channel.channel}: {channel.status}
                          {typeof channel.latencyMs === "number" ? ` (${channel.latencyMs}ms)` : ""}
                        </div>
                      ))}
                    </td>
                    <td>
                      {record.status}
                      {record.dedupeStatus !== "dispatched" ? ` (${record.dedupeStatus})` : ""}
                    </td>
                    <td>{new Date(record.detectedAt).toLocaleString()}</td>
                    <td>
                      <div className="action-group">
                        <button
                          className="action-btn neutral"
                          type="button"
                          disabled={isRefreshing || !canWrite || busyHighRiskId === record.notificationId || record.status === "acknowledged"}
                          onClick={() => void setHighRiskStatus(record, "acknowledged")}
                        >
                          Ack
                        </button>
                        <button
                          className="action-btn primary"
                          type="button"
                          disabled={isRefreshing || !canWrite || busyHighRiskId === record.notificationId || record.status === "resolved"}
                          onClick={() => void setHighRiskStatus(record, "resolved")}
                        >
                          Resolve
                        </button>
                        <button
                          className="action-btn neutral"
                          type="button"
                          disabled={isRefreshing || !canWrite || busyHighRiskId === record.notificationId || record.status === "open"}
                          onClick={() => void setHighRiskStatus(record, "open")}
                        >
                          Reopen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredHighRisk.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No high-risk notifications match the current filters.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mobile-only card-stack">
          {filteredHighRisk.length === 0 ? <p className="muted-note">No high-risk notifications match the current filters.</p> : null}
          {filteredHighRisk.map((record) => (
            <article className="compact-card" key={`mobile-${record.notificationId}`}>
              <p>
                <SeverityBadge severity={record.severity} /> {record.title}
              </p>
              <small>
                {record.agentId} | {record.runId}
              </small>
              <p>{record.explanation}</p>
              <small>
                {record.status} | {record.dedupeStatus} | {new Date(record.detectedAt).toLocaleString()}
              </small>
              <ul className="dense-list">
                {record.channels.map((channel) => (
                  <li key={`${record.notificationId}:${channel.channel}`}>
                    {channel.channel}: {channel.status}
                    {typeof channel.latencyMs === "number" ? ` (${channel.latencyMs}ms)` : ""}
                  </li>
                ))}
              </ul>
              <div className="action-group">
                <button
                  className="action-btn neutral"
                  type="button"
                  disabled={isRefreshing || !canWrite || busyHighRiskId === record.notificationId || record.status === "acknowledged"}
                  onClick={() => void setHighRiskStatus(record, "acknowledged")}
                >
                  Ack
                </button>
                <button
                  className="action-btn primary"
                  type="button"
                  disabled={isRefreshing || !canWrite || busyHighRiskId === record.notificationId || record.status === "resolved"}
                  onClick={() => void setHighRiskStatus(record, "resolved")}
                >
                  Resolve
                </button>
              </div>
            </article>
          ))}
        </div>
      </article>

      <article className="panel">
        <h3>Reasoning Alert Center</h3>
        <p className="muted-note">
          Reasoning alerts are synchronized with local run evidence. Status changes are audited and persisted in local-core state.
        </p>
        {data.alerts.length === 0 ? (
          <p className="muted-note">No reasoning alerts surfaced yet. As runs arrive, quality signals will appear here.</p>
        ) : null}

        <div className="desktop-only">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Severity</th>
                  <th>Confidence</th>
                  <th>Agent</th>
                  <th>Run</th>
                  <th>Title</th>
                  <th>Explanation</th>
                  <th>Evidence</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.alerts.map((alert) => (
                  <tr key={alert.alertId}>
                    <td>{alert.category}</td>
                    <td>
                      <SeverityBadge severity={alert.severity} />
                    </td>
                    <td>{alert.confidence.toFixed(2)}</td>
                    <td>{alert.agentId}</td>
                    <td>{alert.runId}</td>
                    <td>{alert.title}</td>
                    <td>{alert.explanation}</td>
                    <td>{alert.evidenceCount}</td>
                    <td>{alert.status}</td>
                    <td>
                      <div className="action-group">
                        <button
                          className="action-btn neutral"
                          disabled={isRefreshing || !canWrite || busyAlertId === alert.alertId || alert.status === "acknowledged"}
                          onClick={() => void setStatus(alert, "acknowledged")}
                          type="button"
                        >
                          Ack
                        </button>
                        <button
                          className="action-btn danger"
                          disabled={isRefreshing || !canWrite || busyAlertId === alert.alertId || alert.status === "dismissed"}
                          onClick={() => void setStatus(alert, "dismissed")}
                          type="button"
                        >
                          Dismiss
                        </button>
                        <button
                          className="action-btn primary"
                          disabled={isRefreshing || !canWrite || busyAlertId === alert.alertId || alert.status === "resolved"}
                          onClick={() => void setStatus(alert, "resolved")}
                          type="button"
                        >
                          Resolve
                        </button>
                        <button
                          className="action-btn neutral"
                          disabled={isRefreshing || !canWrite || busyAlertId === alert.alertId || alert.status === "open"}
                          onClick={() => void setStatus(alert, "open")}
                          type="button"
                        >
                          Reopen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mobile-only card-stack">
          {data.alerts.map((alert) => (
            <article className="compact-card" key={`reasoning-${alert.alertId}`}>
              <p>
                <SeverityBadge severity={alert.severity} /> {alert.title}
              </p>
              <small>
                {alert.agentId} | {alert.runId} | confidence {alert.confidence.toFixed(2)}
              </small>
              <p>{alert.explanation}</p>
              <small>Status: {alert.status}</small>
              <div className="action-group">
                <button
                  className="action-btn neutral"
                  disabled={isRefreshing || !canWrite || busyAlertId === alert.alertId || alert.status === "acknowledged"}
                  onClick={() => void setStatus(alert, "acknowledged")}
                  type="button"
                >
                  Ack
                </button>
                <button
                  className="action-btn primary"
                  disabled={isRefreshing || !canWrite || busyAlertId === alert.alertId || alert.status === "resolved"}
                  onClick={() => void setStatus(alert, "resolved")}
                  type="button"
                >
                  Resolve
                </button>
              </div>
            </article>
          ))}
        </div>
      </article>
    </section>
  );
}
