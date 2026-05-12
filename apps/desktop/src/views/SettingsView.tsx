import { useEffect, useMemo, useState } from "react";
import {
  getOperatorId,
  getOperatorRole,
  sendHighRiskNotificationTest,
  setOperatorId,
  setOperatorRole,
  togglePlugin,
  updateHighRiskNotificationSettings
} from "../api";
import type { DashboardData, HighRiskNotificationSettingsView, OperatorRole } from "../types";

interface SettingsViewProps {
  data: DashboardData;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
}

interface NotificationDraft {
  enabled: boolean;
  minimumSeverity: "medium" | "high" | "critical";
  minimumConfidence: number;
  dedupeWindowSeconds: number;
  cooldownSeconds: number;
  antiSpamWindowSeconds: number;
  maxNotificationsPerWindow: number;
  channels: {
    inAppBanner: boolean;
    email: boolean;
    webhook: boolean;
  };
  quietHours: {
    enabled: boolean;
    startLocal: string;
    endLocal: string;
    allowCritical: boolean;
  };
  escalation: {
    enabled: boolean;
    severityAtLeast: "high" | "critical";
    afterMinutes: number;
    additionalRecipients: string;
    escalateToWebhook: boolean;
  };
  routing: {
    defaultRecipients: string;
    criticalRecipients: string;
  };
  email: {
    fromAddress: string;
    smtpHost: string;
    smtpPort: number;
    secure: boolean;
    smtpUsername: string;
    smtpPassword: string;
    connectTimeoutMs: number;
    subjectPrefix: string;
  };
  webhook: {
    url: string;
    bearerToken: string;
    timeoutMs: number;
  };
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  slo: {
    p95DispatchTargetMs: number;
  };
}

function joinLines(values: string[]): string {
  return values.join(", ");
}

function toList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function draftFromSettings(settings: HighRiskNotificationSettingsView): NotificationDraft {
  return {
    enabled: settings.enabled,
    minimumSeverity: settings.minimumSeverity,
    minimumConfidence: settings.minimumConfidence,
    dedupeWindowSeconds: settings.dedupeWindowSeconds,
    cooldownSeconds: settings.cooldownSeconds,
    antiSpamWindowSeconds: settings.antiSpamWindowSeconds,
    maxNotificationsPerWindow: settings.maxNotificationsPerWindow,
    channels: { ...settings.channels },
    quietHours: { ...settings.quietHours },
    escalation: {
      ...settings.escalation,
      additionalRecipients: joinLines(settings.escalation.additionalRecipients)
    },
    routing: {
      defaultRecipients: joinLines(settings.routing.defaultRecipients),
      criticalRecipients: joinLines(settings.routing.criticalRecipients)
    },
    email: {
      fromAddress: settings.email.fromAddress ?? "",
      smtpHost: settings.email.smtpHost ?? "",
      smtpPort: settings.email.smtpPort,
      secure: settings.email.secure,
      smtpUsername: settings.email.smtpUsername ?? "",
      smtpPassword: "",
      connectTimeoutMs: settings.email.connectTimeoutMs,
      subjectPrefix: settings.email.subjectPrefix
    },
    webhook: {
      url: settings.webhook.url ?? "",
      bearerToken: "",
      timeoutMs: settings.webhook.timeoutMs
    },
    retry: { ...settings.retry },
    slo: { ...settings.slo }
  };
}

export function SettingsView({ data, onRefresh, isRefreshing }: SettingsViewProps) {
  const [busyPlugin, setBusyPlugin] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<OperatorRole>(getOperatorRole());
  const [actorDraft, setActorDraft] = useState(getOperatorId());
  const [settingsDraft, setSettingsDraft] = useState<NotificationDraft>(() => draftFromSettings(data.notificationCenter.settings));
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [testingNotifications, setTestingNotifications] = useState(false);
  const [feedback, setFeedback] = useState<{ level: "success" | "error"; message: string } | null>(null);
  const canWritePlugins = data.operator.capabilities.includes("plugin:write");
  const canWriteAlerts = data.operator.capabilities.includes("alert:write");

  useEffect(() => {
    setSettingsDraft(draftFromSettings(data.notificationCenter.settings));
  }, [data.notificationCenter.settings]);

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

  async function saveNotificationSettings() {
    setSavingNotifications(true);
    setFeedback(null);
    try {
      await updateHighRiskNotificationSettings({
        enabled: settingsDraft.enabled,
        minimumSeverity: settingsDraft.minimumSeverity,
        minimumConfidence: settingsDraft.minimumConfidence,
        dedupeWindowSeconds: settingsDraft.dedupeWindowSeconds,
        cooldownSeconds: settingsDraft.cooldownSeconds,
        antiSpamWindowSeconds: settingsDraft.antiSpamWindowSeconds,
        maxNotificationsPerWindow: settingsDraft.maxNotificationsPerWindow,
        channels: settingsDraft.channels,
        quietHours: settingsDraft.quietHours,
        retry: settingsDraft.retry,
        routing: {
          defaultRecipients: toList(settingsDraft.routing.defaultRecipients),
          criticalRecipients: toList(settingsDraft.routing.criticalRecipients)
        },
        escalation: {
          enabled: settingsDraft.escalation.enabled,
          severityAtLeast: settingsDraft.escalation.severityAtLeast,
          afterMinutes: settingsDraft.escalation.afterMinutes,
          additionalRecipients: toList(settingsDraft.escalation.additionalRecipients),
          escalateToWebhook: settingsDraft.escalation.escalateToWebhook
        },
        email: {
          fromAddress: settingsDraft.email.fromAddress,
          smtpHost: settingsDraft.email.smtpHost || undefined,
          smtpPort: settingsDraft.email.smtpPort,
          secure: settingsDraft.email.secure,
          smtpUsername: settingsDraft.email.smtpUsername || undefined,
          smtpPassword: settingsDraft.email.smtpPassword || undefined,
          connectTimeoutMs: settingsDraft.email.connectTimeoutMs,
          subjectPrefix: settingsDraft.email.subjectPrefix
        },
        webhook: {
          url: settingsDraft.webhook.url || undefined,
          bearerToken: settingsDraft.webhook.bearerToken || undefined,
          timeoutMs: settingsDraft.webhook.timeoutMs
        },
        slo: settingsDraft.slo
      });
      await onRefresh();
      setSettingsDraft((current) => ({ ...current, email: { ...current.email, smtpPassword: "" }, webhook: { ...current.webhook, bearerToken: "" } }));
      setFeedback({ level: "success", message: "High-risk notification settings saved." });
    } catch (error) {
      setFeedback({ level: "error", message: error instanceof Error ? error.message : "Failed to save settings." });
    } finally {
      setSavingNotifications(false);
    }
  }

  async function runTestAlert() {
    setTestingNotifications(true);
    setFeedback(null);
    try {
      await sendHighRiskNotificationTest({});
      await onRefresh();
      setFeedback({ level: "success", message: "Test high-risk notification sent. Check history and delivery status." });
    } catch (error) {
      setFeedback({ level: "error", message: error instanceof Error ? error.message : "Failed to send test alert." });
    } finally {
      setTestingNotifications(false);
    }
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
          <div className="table-scroll">
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
          </div>
        </article>
      </div>

      <div className="panel-grid">
        <article className="panel">
          <h3>Notification Routing</h3>
          <label className="field-check">
            <input type="checkbox" checked={settingsDraft.enabled} onChange={(event) => setSettingsDraft((state) => ({ ...state, enabled: event.currentTarget.checked }))} />
            <span>Enable high-risk notification engine</span>
          </label>
          <div className="field-row">
            <span>Minimum Severity</span>
            <select value={settingsDraft.minimumSeverity} onChange={(event) => setSettingsDraft((state) => ({ ...state, minimumSeverity: event.currentTarget.value as NotificationDraft["minimumSeverity"] }))}>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
          </div>
          <div className="field-row">
            <span>Minimum Confidence (0-1)</span>
            <input type="number" min={0} max={1} step={0.01} value={settingsDraft.minimumConfidence} onChange={(event) => setSettingsDraft((state) => ({ ...state, minimumConfidence: Number(event.currentTarget.value) }))} />
          </div>
          <label className="field-check">
            <input type="checkbox" checked={settingsDraft.channels.inAppBanner} onChange={(event) => setSettingsDraft((state) => ({ ...state, channels: { ...state.channels, inAppBanner: event.currentTarget.checked } }))} />
            <span>In-app critical banner</span>
          </label>
          <label className="field-check">
            <input type="checkbox" checked={settingsDraft.channels.email} onChange={(event) => setSettingsDraft((state) => ({ ...state, channels: { ...state.channels, email: event.currentTarget.checked } }))} />
            <span>Email delivery</span>
          </label>
          <label className="field-check">
            <input type="checkbox" checked={settingsDraft.channels.webhook} onChange={(event) => setSettingsDraft((state) => ({ ...state, channels: { ...state.channels, webhook: event.currentTarget.checked } }))} />
            <span>Webhook delivery</span>
          </label>
          <label className="field-col">
            <span>Default Recipients (comma separated)</span>
            <input value={settingsDraft.routing.defaultRecipients} onChange={(event) => setSettingsDraft((state) => ({ ...state, routing: { ...state.routing, defaultRecipients: event.currentTarget.value } }))} />
          </label>
          <label className="field-col">
            <span>Critical Recipients (comma separated)</span>
            <input value={settingsDraft.routing.criticalRecipients} onChange={(event) => setSettingsDraft((state) => ({ ...state, routing: { ...state.routing, criticalRecipients: event.currentTarget.value } }))} />
          </label>
        </article>

        <article className="panel">
          <h3>Noise Control and Escalation</h3>
          <div className="field-row">
            <span>Dedupe Window (s)</span>
            <input type="number" min={15} value={settingsDraft.dedupeWindowSeconds} onChange={(event) => setSettingsDraft((state) => ({ ...state, dedupeWindowSeconds: Number(event.currentTarget.value) }))} />
          </div>
          <div className="field-row">
            <span>Cooldown (s)</span>
            <input type="number" min={0} value={settingsDraft.cooldownSeconds} onChange={(event) => setSettingsDraft((state) => ({ ...state, cooldownSeconds: Number(event.currentTarget.value) }))} />
          </div>
          <div className="field-row">
            <span>Anti-Spam Window (s)</span>
            <input type="number" min={30} value={settingsDraft.antiSpamWindowSeconds} onChange={(event) => setSettingsDraft((state) => ({ ...state, antiSpamWindowSeconds: Number(event.currentTarget.value) }))} />
          </div>
          <div className="field-row">
            <span>Max Notifications per Window</span>
            <input type="number" min={1} value={settingsDraft.maxNotificationsPerWindow} onChange={(event) => setSettingsDraft((state) => ({ ...state, maxNotificationsPerWindow: Number(event.currentTarget.value) }))} />
          </div>
          <label className="field-check">
            <input type="checkbox" checked={settingsDraft.quietHours.enabled} onChange={(event) => setSettingsDraft((state) => ({ ...state, quietHours: { ...state.quietHours, enabled: event.currentTarget.checked } }))} />
            <span>Enable quiet hours</span>
          </label>
          <div className="field-row">
            <span>Quiet Hours Start</span>
            <input type="time" value={settingsDraft.quietHours.startLocal} onChange={(event) => setSettingsDraft((state) => ({ ...state, quietHours: { ...state.quietHours, startLocal: event.currentTarget.value } }))} />
          </div>
          <div className="field-row">
            <span>Quiet Hours End</span>
            <input type="time" value={settingsDraft.quietHours.endLocal} onChange={(event) => setSettingsDraft((state) => ({ ...state, quietHours: { ...state.quietHours, endLocal: event.currentTarget.value } }))} />
          </div>
          <label className="field-check">
            <input type="checkbox" checked={settingsDraft.quietHours.allowCritical} onChange={(event) => setSettingsDraft((state) => ({ ...state, quietHours: { ...state.quietHours, allowCritical: event.currentTarget.checked } }))} />
            <span>Allow critical alerts during quiet hours</span>
          </label>
          <label className="field-check">
            <input type="checkbox" checked={settingsDraft.escalation.enabled} onChange={(event) => setSettingsDraft((state) => ({ ...state, escalation: { ...state.escalation, enabled: event.currentTarget.checked } }))} />
            <span>Enable escalation</span>
          </label>
          <div className="field-row">
            <span>Escalate Severity At Least</span>
            <select value={settingsDraft.escalation.severityAtLeast} onChange={(event) => setSettingsDraft((state) => ({ ...state, escalation: { ...state.escalation, severityAtLeast: event.currentTarget.value as "high" | "critical" } }))}>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
          </div>
          <div className="field-row">
            <span>Escalate After (minutes)</span>
            <input type="number" min={1} value={settingsDraft.escalation.afterMinutes} onChange={(event) => setSettingsDraft((state) => ({ ...state, escalation: { ...state.escalation, afterMinutes: Number(event.currentTarget.value) } }))} />
          </div>
          <label className="field-col">
            <span>Escalation Recipients</span>
            <input value={settingsDraft.escalation.additionalRecipients} onChange={(event) => setSettingsDraft((state) => ({ ...state, escalation: { ...state.escalation, additionalRecipients: event.currentTarget.value } }))} />
          </label>
          <label className="field-check">
            <input type="checkbox" checked={settingsDraft.escalation.escalateToWebhook} onChange={(event) => setSettingsDraft((state) => ({ ...state, escalation: { ...state.escalation, escalateToWebhook: event.currentTarget.checked } }))} />
            <span>Escalate to webhook</span>
          </label>
        </article>
      </div>

      <div className="panel-grid">
        <article className="panel">
          <h3>Email and Webhook Channels</h3>
          <label className="field-col">
            <span>SMTP Host</span>
            <input value={settingsDraft.email.smtpHost} onChange={(event) => setSettingsDraft((state) => ({ ...state, email: { ...state.email, smtpHost: event.currentTarget.value } }))} />
          </label>
          <div className="field-row">
            <span>SMTP Port</span>
            <input type="number" min={1} value={settingsDraft.email.smtpPort} onChange={(event) => setSettingsDraft((state) => ({ ...state, email: { ...state.email, smtpPort: Number(event.currentTarget.value) } }))} />
          </div>
          <label className="field-check">
            <input type="checkbox" checked={settingsDraft.email.secure} onChange={(event) => setSettingsDraft((state) => ({ ...state, email: { ...state.email, secure: event.currentTarget.checked } }))} />
            <span>SMTP secure (TLS)</span>
          </label>
          <label className="field-col">
            <span>SMTP Username</span>
            <input value={settingsDraft.email.smtpUsername} onChange={(event) => setSettingsDraft((state) => ({ ...state, email: { ...state.email, smtpUsername: event.currentTarget.value } }))} />
          </label>
          <label className="field-col">
            <span>SMTP Password</span>
            <input type="password" placeholder={data.notificationCenter.settings.email.hasPassword ? "Stored password exists. Enter to rotate." : "Enter SMTP password"} value={settingsDraft.email.smtpPassword} onChange={(event) => setSettingsDraft((state) => ({ ...state, email: { ...state.email, smtpPassword: event.currentTarget.value } }))} />
          </label>
          <label className="field-col">
            <span>From Address</span>
            <input value={settingsDraft.email.fromAddress} onChange={(event) => setSettingsDraft((state) => ({ ...state, email: { ...state.email, fromAddress: event.currentTarget.value } }))} />
          </label>
          <label className="field-col">
            <span>Webhook URL</span>
            <input value={settingsDraft.webhook.url} onChange={(event) => setSettingsDraft((state) => ({ ...state, webhook: { ...state.webhook, url: event.currentTarget.value } }))} />
          </label>
          <label className="field-col">
            <span>Webhook Bearer Token</span>
            <input type="password" placeholder={data.notificationCenter.settings.webhook.hasBearerToken ? "Stored token exists. Enter to rotate." : "Optional token"} value={settingsDraft.webhook.bearerToken} onChange={(event) => setSettingsDraft((state) => ({ ...state, webhook: { ...state.webhook, bearerToken: event.currentTarget.value } }))} />
          </label>
          <p className="muted-note">
            Email configured: {data.notificationCenter.settings.email.configured ? "yes" : "no"} | Webhook configured:{" "}
            {data.notificationCenter.settings.webhook.configured ? "yes" : "no"}
          </p>
        </article>

        <article className="panel">
          <h3>Delivery SLO and Operations</h3>
          <ul className="dense-list">
            <li>Dispatch p95: {data.notificationCenter.slo.measuredP95Ms} ms (target {data.notificationCenter.slo.targetP95Ms} ms)</li>
            <li>Dispatch p50: {data.notificationCenter.slo.measuredP50Ms} ms</li>
            <li>Sample size: {data.notificationCenter.slo.sampleSize}</li>
            <li>Queue depth: {data.notificationCenter.slo.queueDepth}</li>
            <li>Failed deliveries (24h): {data.notificationCenter.slo.failedDeliveryCount24h}</li>
            <li>Detected high-risk events: {data.notificationCenter.pipeline.detected}</li>
            <li>Suppressed high-risk events: {data.notificationCenter.pipeline.suppressed}</li>
          </ul>
          <div className="action-group">
            <button className="action-btn primary" type="button" disabled={isRefreshing || savingNotifications || !canWriteAlerts} onClick={() => void saveNotificationSettings()}>
              {savingNotifications ? "Saving..." : "Save Notification Settings"}
            </button>
            <button className="action-btn neutral" type="button" disabled={isRefreshing || testingNotifications || !canWriteAlerts} onClick={() => void runTestAlert()}>
              {testingNotifications ? "Sending..." : "Send Test Alert"}
            </button>
          </div>
          {!canWriteAlerts ? <p className="muted-note">Current role cannot update alert or notification controls.</p> : null}
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
            <li>High-risk notifications include explainability, confidence, and delivery audit trails.</li>
          </ul>
        </article>
      </div>
    </section>
  );
}
