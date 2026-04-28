import { useMemo, useState } from "react";
import { getOperatorId, getOperatorRole, setOperatorId, setOperatorRole, togglePlugin } from "../api";
import type { DashboardData, OperatorRole } from "../types";

interface SettingsViewProps {
  data: DashboardData;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
}

export function SettingsView({ data, onRefresh, isRefreshing }: SettingsViewProps) {
  const [busyPlugin, setBusyPlugin] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<OperatorRole>(getOperatorRole());
  const [actorDraft, setActorDraft] = useState(getOperatorId());
  const [feedback, setFeedback] = useState<{ level: "success" | "error"; message: string } | null>(null);
  const canWritePlugins = data.operator.capabilities.includes("plugin:write");

  const capabilitySummary = useMemo(
    () => (data.operator.capabilities.length > 0 ? data.operator.capabilities.join(", ") : "No write capabilities"),
    [data.operator.capabilities]
  );

  async function handleToggle(pluginId: string, nextEnabled: boolean) {
    setBusyPlugin(pluginId);
    setFeedback(null);
    try {
      await togglePlugin(pluginId, nextEnabled);
      await onRefresh();
      setFeedback({
        level: "success",
        message: `${pluginId} ${nextEnabled ? "enabled" : "disabled"} successfully.`
      });
    } catch (error) {
      setFeedback({
        level: "error",
        message: error instanceof Error ? error.message : "Failed to toggle plugin."
      });
    } finally {
      setBusyPlugin(null);
    }
  }

  async function applyOperatorContext() {
    setFeedback(null);
    setOperatorRole(roleDraft);
    setOperatorId(actorDraft);
    await onRefresh();
    setFeedback({
      level: "success",
      message: `Operator context updated to role "${roleDraft}" and actor "${actorDraft || "default"}".`
    });
  }

  return (
    <section className="view">
      <div className="panel-grid">
        <article className="panel">
          <h3>Operator Context</h3>
          {feedback ? <p className={feedback.level === "error" ? "feedback error" : "feedback success"}>{feedback.message}</p> : null}
          <p className="muted-note">Role controls govern which write operations are allowed in this desktop session.</p>
          <label className="field-col">
            <span>Role</span>
            <select value={roleDraft} onChange={(event) => setRoleDraft(event.currentTarget.value as OperatorRole)}>
              <option value="owner">owner</option>
              <option value="operator">operator</option>
              <option value="reviewer">reviewer</option>
              <option value="auditor">auditor</option>
              <option value="read_only">read_only</option>
            </select>
          </label>
          <label className="field-col">
            <span>Actor ID</span>
            <input value={actorDraft} onChange={(event) => setActorDraft(event.currentTarget.value)} />
          </label>
          <div className="action-group">
            <button className="action-btn primary" disabled={isRefreshing} onClick={() => void applyOperatorContext()} type="button">
              Apply Context
            </button>
          </div>
          <ul className="dense-list">
            <li>Server role: {data.operator.role}</li>
            <li>Server actor: {data.operator.actorId}</li>
            <li>Capabilities: {capabilitySummary}</li>
          </ul>
        </article>
        <article className="panel">
          <h3>Connector Registry</h3>
          <table>
            <thead>
              <tr>
                <th>Connector</th>
                <th>Capabilities</th>
                <th>Status</th>
                <th>Last Sync</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {data.connectors.map((connector) => (
                <tr key={connector.connectorId}>
                  <td>{connector.connectorId}</td>
                  <td>{connector.scope}</td>
                  <td>{connector.status}</td>
                  <td>{new Date(connector.lastSync).toLocaleString()}</td>
                  <td>{connector.enabled ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </div>
      <div className="panel-grid">
        <article className="panel">
          <h3>Plugin Control</h3>
          {!canWritePlugins ? <p className="muted-note">Current role cannot toggle plugins.</p> : null}
          <ul className="dense-list">
            {data.plugins.map((plugin) => (
              <li key={plugin.pluginId}>
                <strong>{plugin.name}</strong> ({plugin.status}) - {plugin.description}
                <div className="action-group">
                  <button
                    className="action-btn neutral"
                    disabled={isRefreshing || busyPlugin === plugin.pluginId || !canWritePlugins}
                    onClick={() => void handleToggle(plugin.pluginId, !plugin.enabled)}
                    type="button"
                  >
                    {busyPlugin === plugin.pluginId
                      ? "Saving..."
                      : plugin.enabled
                        ? "Disable"
                        : plugin.sourceCount === 0
                          ? "Enable (needs source)"
                          : "Enable"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </article>
        <article className="panel">
          <h3>Trust Defaults</h3>
          <ul className="dense-list">
            <li>Local-first processing is active.</li>
            <li>Every source path must be explicitly approved before ingestion.</li>
            <li>Disabled plugins do not ingest or sync data.</li>
            <li>Validation checks show exactly what is connected, degraded, or missing.</li>
            <li>Operator role and actor identity are sent on every mutating API request.</li>
          </ul>
        </article>
      </div>
    </section>
  );
}
