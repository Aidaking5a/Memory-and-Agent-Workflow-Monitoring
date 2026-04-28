import { useMemo, useState } from "react";
import { connectOpenClawWorkspace, discoverOpenClawWorkspace, validateOpenClawSetup } from "../api";
import type { DashboardData, SetupState } from "../types";

interface OnboardingViewProps {
  data: DashboardData;
  onRefresh: () => Promise<void>;
}

function toLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function OnboardingView({ data, onRefresh }: OnboardingViewProps) {
  const [workspacePath, setWorkspacePath] = useState(data.connection.workspacePath ?? "");
  const [memoryPath, setMemoryPath] = useState(data.connection.discoveredSources.memoryPath ?? "");
  const [bootstrapPath, setBootstrapPath] = useState(data.connection.discoveredSources.bootstrapPath ?? "");
  const [codexPaths, setCodexPaths] = useState(data.connection.discoveredSources.codexLogPaths.join("\n"));
  const [customPaths, setCustomPaths] = useState(data.connection.discoveredSources.customJsonLogPaths.join("\n"));
  const [openClawPaths, setOpenClawPaths] = useState(data.connection.discoveredSources.openClawLogPaths.join("\n"));
  const [runtimeEnabled, setRuntimeEnabled] = useState(data.connection.runtime.enabled);
  const [runtimeMode, setRuntimeMode] = useState<"hybrid" | "log_only" | "rpc_only">(data.connection.runtime.mode);
  const [runtimeEndpoint, setRuntimeEndpoint] = useState(data.connection.runtime.endpoint ?? "");
  const [runtimeApiKey, setRuntimeApiKey] = useState("");
  const [connectionMethod, setConnectionMethod] = useState<"workspace_scan" | "manual_paths">(
    data.connection.connectionMethod === "workspace_scan" ? "workspace_scan" : "manual_paths"
  );
  const [permissions, setPermissions] = useState<SetupState["permissions"]>(data.connection.permissions);
  const [pluginEnabled, setPluginEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(data.plugins.map((plugin) => [plugin.pluginId, plugin.enabled]))
  );
  const [busy, setBusy] = useState<"discover" | "connect" | "validate" | null>(null);
  const [feedback, setFeedback] = useState<{ level: "success" | "error"; message: string } | null>(null);

  const checks = useMemo(() => data.connection.health.checks, [data.connection.health.checks]);

  async function handleDiscover() {
    if (!workspacePath.trim()) {
      setFeedback({ level: "error", message: "Workspace path is required before discovery." });
      return;
    }
    setBusy("discover");
    setFeedback(null);
    try {
      const discovered = await discoverOpenClawWorkspace(workspacePath.trim());
      setMemoryPath(discovered.memoryPath ?? "");
      setBootstrapPath(discovered.bootstrapPath ?? "");
      setCodexPaths(discovered.codexLogPaths.join("\n"));
      setCustomPaths(discovered.customJsonLogPaths.join("\n"));
      setOpenClawPaths(discovered.openClawLogPaths.join("\n"));
      setFeedback({ level: "success", message: "Workspace discovery completed. Review sources and connect." });
      await onRefresh();
    } catch (error) {
      setFeedback({ level: "error", message: error instanceof Error ? error.message : "Discovery failed." });
    } finally {
      setBusy(null);
    }
  }

  async function handleConnect() {
    if (!workspacePath.trim()) {
      setFeedback({ level: "error", message: "Workspace path is required." });
      return;
    }
    setBusy("connect");
    setFeedback(null);
    try {
      await connectOpenClawWorkspace({
        connectionMethod,
        workspacePath: workspacePath.trim(),
        grantWorkspaceAccess: permissions.workspaceAccessGranted,
        permissions,
        sources: {
          memoryPath: memoryPath || undefined,
          bootstrapPath: bootstrapPath || undefined,
          codexLogPaths: toLines(codexPaths),
          customJsonLogPaths: toLines(customPaths),
          openClawLogPaths: toLines(openClawPaths)
        },
        runtime: {
          enabled: runtimeEnabled,
          mode: runtimeMode,
          endpoint: runtimeEndpoint.trim() || undefined,
          apiKey: runtimeApiKey.trim() || undefined
        },
        pluginEnabled
      });
      await onRefresh();
      setFeedback({ level: "success", message: "OpenClaw setup linked. Run validation to verify health." });
    } catch (error) {
      setFeedback({ level: "error", message: error instanceof Error ? error.message : "Connection failed." });
    } finally {
      setBusy(null);
    }
  }

  async function handleValidate() {
    setBusy("validate");
    setFeedback(null);
    try {
      const health = await validateOpenClawSetup();
      await onRefresh();
      setFeedback({
        level: health.status === "healthy" ? "success" : "error",
        message:
          health.status === "healthy"
            ? "Validation succeeded. Connectors and permissions look healthy."
            : "Validation completed with warnings. Review health checks below."
      });
    } catch (error) {
      setFeedback({ level: "error", message: error instanceof Error ? error.message : "Validation failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="view">
      <article className="panel">
        <h3>OpenClaw Onboarding</h3>
        <p className="muted-note">
          Link your local workspace, review sources and permissions, then validate connector health before relying on
          dashboard insights.
        </p>
        <div className="onboarding-grid">
          <label className="field-col">
            <span>Connection method</span>
            <select value={connectionMethod} onChange={(event) => setConnectionMethod(event.currentTarget.value as "workspace_scan" | "manual_paths")}>
              <option value="workspace_scan">Workspace scan</option>
              <option value="manual_paths">Manual source paths</option>
            </select>
          </label>
          <label className="field-col">
            <span>Workspace path</span>
            <input value={workspacePath} onChange={(event) => setWorkspacePath(event.currentTarget.value)} />
          </label>
        </div>
        <div className="action-group">
          <button className="action-btn neutral" disabled={busy !== null} onClick={() => void handleDiscover()} type="button">
            {busy === "discover" ? "Discovering..." : "Discover Sources"}
          </button>
        </div>
      </article>

      <div className="panel-grid">
        <article className="panel">
          <h3>Memory Sources</h3>
          <label className="field-col">
            <span>memory.md path</span>
            <input value={memoryPath} onChange={(event) => setMemoryPath(event.currentTarget.value)} />
          </label>
          <label className="field-col">
            <span>bootstrap.md path</span>
            <input value={bootstrapPath} onChange={(event) => setBootstrapPath(event.currentTarget.value)} />
          </label>
        </article>
        <article className="panel">
          <h3>Workflow Log Sources</h3>
          <label className="field-col">
            <span>OpenClaw logs (one path per line)</span>
            <textarea rows={3} value={openClawPaths} onChange={(event) => setOpenClawPaths(event.currentTarget.value)} />
          </label>
          <label className="field-col">
            <span>Codex logs (one path per line)</span>
            <textarea rows={3} value={codexPaths} onChange={(event) => setCodexPaths(event.currentTarget.value)} />
          </label>
          <label className="field-col">
            <span>Custom JSON logs (one path per line)</span>
            <textarea rows={3} value={customPaths} onChange={(event) => setCustomPaths(event.currentTarget.value)} />
          </label>
        </article>
      </div>

      <div className="panel-grid">
        <article className="panel">
          <h3>OpenClaw Runtime RPC (Optional)</h3>
          <p className="muted-note">
            Use runtime mode for direct OpenClaw event pull without relying only on log files. Keep this disabled if you
            only use local log ingestion.
          </p>
          <label className="field-check">
            <input checked={runtimeEnabled} onChange={(event) => setRuntimeEnabled(event.currentTarget.checked)} type="checkbox" />
            <span>Enable runtime connector</span>
          </label>
          <label className="field-col">
            <span>Runtime mode</span>
            <select value={runtimeMode} onChange={(event) => setRuntimeMode(event.currentTarget.value as "hybrid" | "log_only" | "rpc_only")}>
              <option value="hybrid">Hybrid (logs + runtime)</option>
              <option value="rpc_only">Runtime only</option>
              <option value="log_only">Logs only</option>
            </select>
          </label>
          <label className="field-col">
            <span>Runtime endpoint URL</span>
            <input placeholder="http://localhost:7001/events" value={runtimeEndpoint} onChange={(event) => setRuntimeEndpoint(event.currentTarget.value)} />
          </label>
          <label className="field-col">
            <span>Runtime API key (optional)</span>
            <input placeholder="Bearer token value" value={runtimeApiKey} onChange={(event) => setRuntimeApiKey(event.currentTarget.value)} />
          </label>
          {data.connection.runtime.hasApiKey ? <p className="muted-note">An existing runtime API key is already stored locally.</p> : null}
        </article>
        <article className="panel">
          <h3>Permission Review</h3>
          <label className="field-check">
            <input
              checked={permissions.workspaceAccessGranted}
              onChange={(event) =>
                setPermissions((previous) => ({ ...previous, workspaceAccessGranted: event.currentTarget.checked }))
              }
              type="checkbox"
            />
            <span>Grant workspace path access</span>
          </label>
          <label className="field-check">
            <input
              checked={permissions.readMemoryFiles}
              onChange={(event) =>
                setPermissions((previous) => ({ ...previous, readMemoryFiles: event.currentTarget.checked }))
              }
              type="checkbox"
            />
            <span>Allow memory file parsing</span>
          </label>
          <label className="field-check">
            <input
              checked={permissions.readWorkflowEvents}
              onChange={(event) =>
                setPermissions((previous) => ({ ...previous, readWorkflowEvents: event.currentTarget.checked }))
              }
              type="checkbox"
            />
            <span>Allow workflow event ingestion</span>
          </label>
          <label className="field-check">
            <input
              checked={permissions.readPrompts}
              onChange={(event) =>
                setPermissions((previous) => ({ ...previous, readPrompts: event.currentTarget.checked }))
              }
              type="checkbox"
            />
            <span>Allow prompt metadata ingestion (authorized only)</span>
          </label>
        </article>
        <article className="panel">
          <h3>Plugin Enablement</h3>
          {data.plugins.map((plugin) => (
            <label className="field-check" key={plugin.pluginId}>
              <input
                checked={Boolean(pluginEnabled[plugin.pluginId])}
                onChange={(event) =>
                  setPluginEnabled((previous) => ({ ...previous, [plugin.pluginId]: event.currentTarget.checked }))
                }
                type="checkbox"
              />
              <span>{plugin.name}</span>
            </label>
          ))}
          <p className="muted-note">Disabled plugins remain visible but do not ingest data.</p>
        </article>
      </div>

      <article className="panel">
        <div className="action-group">
          <button className="action-btn primary" disabled={busy !== null} onClick={() => void handleConnect()} type="button">
            {busy === "connect" ? "Connecting..." : "Connect Setup"}
          </button>
          <button className="action-btn neutral" disabled={busy !== null} onClick={() => void handleValidate()} type="button">
            {busy === "validate" ? "Validating..." : "Run Health Check"}
          </button>
        </div>
        {feedback ? <p className={feedback.level === "error" ? "feedback error" : "feedback success"}>{feedback.message}</p> : null}
        <h4>Current Health Checks</h4>
        <ul className="dense-list">
          {checks.map((check) => (
            <li key={check.id}>
              <strong>[{check.status}]</strong> {check.label}: {check.detail}
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
