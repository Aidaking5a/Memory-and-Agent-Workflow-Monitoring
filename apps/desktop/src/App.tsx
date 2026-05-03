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
  subscribeOpenClawTelemetryStream
} from "./api";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { emptyDashboardData } from "./mock-data";
import type { DashboardData, ViewKey } from "./types";
import { AgentsView } from "./views/AgentsView";
import { AlertsView } from "./views/AlertsView";
import { AuditView } from "./views/AuditView";
import { CompareView } from "./views/CompareView";
import { MemoryView } from "./views/MemoryView";
import { OpenClawView } from "./views/OpenClawView";
import { OnboardingView } from "./views/OnboardingView";
import { OverviewView } from "./views/OverviewView";
import { SettingsView } from "./views/SettingsView";
import { TimelineView } from "./views/TimelineView";
import { WorkflowGovernanceView } from "./views/WorkflowGovernanceView";
import { AuthView } from "./views/AuthView";

const VIEW_LABELS: Record<ViewKey, string> = {
  onboarding: "OpenClaw Setup",
  openclaw: "OpenClaw Operations",
  overview: "Overview Dashboard",
  agents: "Agent List and Health",
  timeline: "Workflow Timeline",
  memory: "Memory Explorer",
  alerts: "Reasoning Alert Center",
  governance: "Workflow Governance",
  compare: "Agent Comparison",
  audit: "Audit and Permissions",
  settings: "Settings and Connectors"
};

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

export function App() {
  const [view, setView] = useState<ViewKey>("overview");
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
    if (!data.connection.connected) {
      setView("onboarding");
    } else if (view === "onboarding") {
      setView("overview");
    }
  }, [authenticated, data.connection.connected, view]);

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
      setView("overview");
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
      setView("overview");
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

  const body = useMemo(() => {
    switch (view) {
      case "onboarding":
        return <OnboardingView data={data} onRefresh={refreshData} />;
      case "overview":
        return <OverviewView data={data} onOpenClawOps={() => setView("openclaw")} />;
      case "openclaw":
        return (
          <OpenClawView
            data={data}
            onOpenSetup={() => setView("onboarding")}
            onRefresh={refreshData}
            streamStatus={openClawStreamStatus}
            streamMessage={openClawStreamMessage}
          />
        );
      case "agents":
        return <AgentsView data={data} />;
      case "timeline":
        return <TimelineView data={data} />;
      case "memory":
        return <MemoryView data={data} />;
      case "alerts":
        return <AlertsView data={data} onRefresh={refreshData} isRefreshing={isRefreshing} />;
      case "governance":
        return <WorkflowGovernanceView data={data} onRefresh={refreshData} isRefreshing={isRefreshing} />;
      case "compare":
        return <CompareView data={data} />;
      case "audit":
        return <AuditView data={data} />;
      case "settings":
        return <SettingsView data={data} onRefresh={refreshData} isRefreshing={isRefreshing} />;
      default:
        return <OverviewView data={data} onOpenClawOps={() => setView("openclaw")} />;
    }
  }, [data, isRefreshing, openClawStreamMessage, openClawStreamStatus, refreshData, view]);

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
          onSignOut={() => {
            void handleLogout();
          }}
        />
        <section className="view-header">
          <h2>{VIEW_LABELS[view]}</h2>
          <p>
            {data.connection.connected
              ? "Transparent local-first control surface for memory, workflow quality, and operator governance."
              : "Complete setup first to enable real memory, token, workload, and reasoning observability."}
          </p>
        </section>
        {data.notificationCenter.banner ? (
          <section className="critical-banner" role="status" aria-live="polite">
            <div>
              <strong>High-Risk Action: {data.notificationCenter.banner.title}</strong>
              <p>
                {data.notificationCenter.banner.agentId} | {data.notificationCenter.banner.runId} |{" "}
                {new Date(data.notificationCenter.banner.detectedAt).toLocaleString()}
              </p>
            </div>
            <button className="action-btn danger" type="button" onClick={() => setView("alerts")}>
              Open Alert Center
            </button>
          </section>
        ) : null}
        {body}
      </main>
    </div>
  );
}
