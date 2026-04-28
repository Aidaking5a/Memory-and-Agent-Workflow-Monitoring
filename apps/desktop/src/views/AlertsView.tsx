import { useState } from "react";
import { updateAlertStatus } from "../api";
import { SeverityBadge } from "../components/SeverityBadge";
import type { AlertItem, DashboardData } from "../types";

interface AlertsViewProps {
  data: DashboardData;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
}

export function AlertsView({ data, onRefresh, isRefreshing }: AlertsViewProps) {
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ level: "success" | "error"; message: string } | null>(null);
  const canWrite = data.operator.capabilities.includes("alert:write");

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

  return (
    <section className="view">
      <article className="panel">
        <h3>Reasoning Alert Center</h3>
        <p className="muted-note">
          Alerts are synchronized with local run evidence. Status changes are audited and persisted in local-core state.
        </p>
        {feedback ? <p className={feedback.level === "error" ? "feedback error" : "feedback success"}>{feedback.message}</p> : null}
        {!canWrite ? <p className="muted-note">Current role is read-only for alert operations.</p> : null}
        {data.alerts.length === 0 ? (
          <p className="muted-note">No alerts surfaced yet. As runs arrive, alert quality signals will appear here.</p>
        ) : null}
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
      </article>
    </section>
  );
}
