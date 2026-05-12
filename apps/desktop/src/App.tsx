import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiAuthError,
  clearAuthSession,
  getAuthUserEmail,
  loadAuthProfile,
  loadDashboardData,
  logoutLocalAccount,
  signinLocalAccount,
  signupLocalAccount,
  subscribeOpenClawTelemetryStream,
  triggerEmergencyStop
} from "./api";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { emptyDashboardData } from "./mock-data";
import type { DashboardData, HighRiskNotificationRecord, ViewKey } from "./types";
import { AgentsView } from "./views/AgentsView";
import { AuthView } from "./views/AuthView";

const LIVE_BANNER_WINDOW_MS = 10 * 60 * 1000;

function mergeOpenClawLive(
  current: DashboardData["openClawLive"],
  incoming: Partial<DashboardData["openClawLive"]> | undefined
): DashboardData["openClawLive"] {
  if (!incoming) return current;
  return {
    ...current,
    ...incoming,
    runtime: {
      ...current.runtime,
      ...(incoming.runtime ?? {})
    },
    sourceHealth: {
      ...current.sourceHealth,
      ...(incoming.sourceHealth ?? {})
    },
    operations: {
      ...current.operations,
      ...(incoming.operations ?? {})
    },
    telemetry: {
      ...current.telemetry,
      ...(incoming.telemetry ?? {})
    },
    recentActivity: Array.isArray(incoming.recentActivity) ? incoming.recentActivity : current.recentActivity,
    reconnectHints: Array.isArray(incoming.reconnectHints) ? incoming.reconnectHints : current.reconnectHints
  };
}

function isFileIngestionReplay(record: HighRiskNotificationRecord): boolean {
  return record.runId === "run:file-ingestion" || record.sourceEventId.startsWith("local-file-main:");
}

function isLiveHighRiskBanner(record: HighRiskNotificationRecord | undefined, nowMs = Date.now()): record is HighRiskNotificationRecord {
  if (!record) return false;
  const detectedAt = new Date(record.detectedAt).getTime();
  if (!Number.isFinite(detectedAt)) return false;
  return (
    record.status === "open" &&
    record.dedupeStatus === "dispatched" &&
    (record.severity === "high" || record.severity === "critical") &&
    record.channels.some((channel) => channel.channel === "in_app_banner" && channel.status === "sent") &&
    nowMs - detectedAt >= 0 &&
    nowMs - detectedAt <= LIVE_BANNER_WINDOW_MS &&
    !isFileIngestionReplay(record)
  );
}

export function App() {
  const [view, setView] = useState<ViewKey>("dashboard");
  const [data, setData] = useState<DashboardData>(emptyDashboardData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | undefined>(undefined);
  const [authEmail, setAuthEmail] = useState<string | null>(getAuthUserEmail());
  const [openClawStreamStatus, setOpenClawStreamStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [openClawStreamMessage, setOpenClawStreamMessage] = useState<string | undefined>(undefined);
  const [openClawStreamAttempt, setOpenClawStreamAttempt] = useState(0);

  const refreshData = useCallback(async () => {
    if (!authenticated) return;
    setIsRefreshing(true);
    try {
      const next = await loadDashboardData();
      setData(next);
      setAuthError(undefined);
    } catch (error) {
      if (error instanceof ApiAuthError) {
        setAuthenticated(false);
        setAuthEmail(null);
        setAuthError("Session expired. Sign in again.");
        return;
      }
      setAuthError(error instanceof Error ? error.message : "Unable to refresh dashboard data.");
    } finally {
      setIsRefreshing(false);
    }
  }, [authenticated]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setAuthBusy(true);
      try {
        const profile = await loadAuthProfile();
        if (cancelled) return;
        if (profile.authenticated && profile.user) {
          setAuthenticated(true);
          setAuthEmail(profile.user.email);
          setAuthError(undefined);
        } else {
          setAuthenticated(false);
        }
      } finally {
        if (!cancelled) {
          setAuthBusy(false);
          setAuthReady(true);
        }
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authenticated) {
      void refreshData();
    }
  }, [authenticated, refreshData]);

  useEffect(() => {
    if (!authenticated) return;
    if (!["dashboard", "network", "stats", "cards", "activity", "costs", "security", "settings", "help"].includes(view)) {
      setView("dashboard");
    }
  }, [authenticated, view]);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => {
      void refreshData();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [authenticated, refreshData]);

  useEffect(() => {
    if (!authenticated) {
      setOpenClawStreamStatus("idle");
      setOpenClawStreamMessage(undefined);
      return;
    }

    setOpenClawStreamStatus("connecting");
    setOpenClawStreamMessage("Connecting to OpenClaw live stream...");
    let refreshTimer: number | undefined;
    let reconnectTimer: number | undefined;
    const scheduleRefresh = () => {
      if (refreshTimer !== undefined) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        void refreshData();
      }, 1200);
    };

    const unsubscribe = subscribeOpenClawTelemetryStream({
      onReady: () => {
        setOpenClawStreamStatus("live");
        setOpenClawStreamMessage("OpenClaw stream connected.");
      },
      onSnapshot: (payload) => {
        const snapshot = payload as { openClawLive?: Partial<DashboardData["openClawLive"]>; generatedAt?: string } | undefined;
        if (!snapshot) return;
        setData((previous) => ({
          ...previous,
          generatedAt: snapshot.generatedAt ?? previous.generatedAt,
          openClawLive: mergeOpenClawLive(previous.openClawLive, snapshot.openClawLive)
        }));
      },
      onUpdate: (payload) => {
        const update = payload as {
          snapshot?: { openClawLive?: Partial<DashboardData["openClawLive"]>; generatedAt?: string };
        };
        const snapshot = update?.snapshot;
        if (snapshot?.openClawLive) {
          setData((previous) => ({
            ...previous,
            generatedAt: snapshot.generatedAt ?? previous.generatedAt,
            openClawLive: mergeOpenClawLive(previous.openClawLive, snapshot.openClawLive)
          }));
        }
        scheduleRefresh();
      },
      onError: (error) => {
        if (error instanceof ApiAuthError) {
          clearAuthSession();
          setAuthenticated(false);
          setAuthEmail(null);
          setAuthError("Session expired. Sign in again.");
          return;
        }
        setOpenClawStreamStatus("error");
        setOpenClawStreamMessage(error.message);
        reconnectTimer = window.setTimeout(() => {
          setOpenClawStreamAttempt((previous) => previous + 1);
        }, 3000);
      }
    });

    return () => {
      unsubscribe();
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
      }
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
    };
  }, [authenticated, openClawStreamAttempt, refreshData]);

  const handleSignIn = useCallback(async (email: string, password: string) => {
    setAuthBusy(true);
    setAuthError(undefined);
    try {
      const session = await signinLocalAccount(email, password);
      setAuthenticated(true);
      setAuthEmail(session.user.email);
      setView("dashboard");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const handleSignUp = useCallback(async (email: string, password: string) => {
    setAuthBusy(true);
    setAuthError(undefined);
    try {
      const session = await signupLocalAccount(email, password);
      setAuthenticated(true);
      setAuthEmail(session.user.email);
      setView("dashboard");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to create account.");
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await logoutLocalAccount();
    setAuthenticated(false);
    setAuthEmail(null);
    setData(emptyDashboardData);
  }, []);

  const handleGlobalEmergencyStop = useCallback(async () => {
    const confirmed = window.confirm(
      "Stop all controllable OpenClaw/local agent activity now? This action is logged and agents will not auto-reconnect without approval."
    );
    if (!confirmed) return;
    try {
      await triggerEmergencyStop("Operator triggered global emergency stop from dashboard header.");
      await refreshData();
      setView("security");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to trigger emergency stop.");
    }
  }, [refreshData]);

  const liveBanner = useMemo(() => isLiveHighRiskBanner(data.notificationCenter.banner) ? data.notificationCenter.banner : undefined, [data.notificationCenter.banner]);
  const liveNotificationCount = useMemo(
    () => data.notificationCenter.history.filter((record) => isLiveHighRiskBanner(record)).length,
    [data.notificationCenter.history]
  );

  const body = useMemo(() => {
    switch (view) {
      case "dashboard":
        return <AgentsView data={data} mode="dashboard" />;
      case "network":
        return <AgentsView data={data} mode="network" />;
      case "stats":
        return <AgentsView data={data} mode="stats" />;
      case "cards":
        return <AgentsView data={data} mode="cards" />;
      case "activity":
        return <AgentsView data={data} mode="activity" />;
      case "costs":
        return <AgentsView data={data} mode="costs" />;
      case "security":
        return <AgentsView data={data} mode="security" />;
      case "settings":
        return <AgentsView data={data} mode="settings" />;
      case "help":
        return <AgentsView data={data} mode="help" />;
      default:
        return <AgentsView data={data} mode="dashboard" />;
    }
  }, [data, view]);

  if (!authReady) {
    return (
      <div className="auth-shell">
        <section className="auth-card">
          <h2>Loading Theia Control Center</h2>
          <p className="muted-note">Verifying local session and workspace state...</p>
        </section>
      </div>
    );
  }

  if (!authenticated) {
    return <AuthView busy={authBusy} error={authError} onSignIn={handleSignIn} onSignUp={handleSignUp} />;
  }

  return (
    <div className="app-shell">
      <Sidebar current={view} onSelect={setView} />
      <main className="content">
        <TopBar
          workspaceName={data.workspaceName}
          timeRange={data.timeRange}
          connected={data.connection.connected}
          generatedAt={data.generatedAt}
          signedInEmail={authEmail}
          notificationCount={liveNotificationCount}
          onAddAgent={() => setView("network")}
          onEmergencyStop={() => {
            void handleGlobalEmergencyStop();
          }}
          onSignOut={() => {
            void handleLogout();
          }}
        />
        {liveBanner ? (
          <section className="critical-banner" role="status" aria-live="polite">
            <div>
              <strong>Live High-Risk Activity: {liveBanner.title}</strong>
              <p>
                {liveBanner.agentId} | {liveBanner.runId} | {new Date(liveBanner.detectedAt).toLocaleString()}
              </p>
            </div>
            <button className="action-btn danger" type="button" onClick={() => setView("dashboard")}>
              Open Agent
            </button>
          </section>
        ) : null}
        {body}
      </main>
    </div>
  );
}
