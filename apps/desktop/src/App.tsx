import { useCallback, useEffect, useMemo, useState } from "react";
import { loadDashboardData } from "./api";
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

export function App() {
  const [view, setView] = useState<ViewKey>("overview");
  const [data, setData] = useState<DashboardData>(emptyDashboardData);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const next = await loadDashboardData();
      setData(next);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!data.connection.connected) {
      setView("onboarding");
    } else if (view === "onboarding") {
      setView("overview");
    }
  }, [data.connection.connected, view]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshData();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [refreshData]);

  const body = useMemo(() => {
    switch (view) {
      case "onboarding":
        return <OnboardingView data={data} onRefresh={refreshData} />;
      case "overview":
        return <OverviewView data={data} onOpenClawOps={() => setView("openclaw")} />;
      case "openclaw":
        return <OpenClawView data={data} onOpenSetup={() => setView("onboarding")} />;
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
  }, [data, isRefreshing, refreshData, view]);

  return (
    <div className="app-shell">
      <Sidebar current={view} onSelect={setView} />
      <main className="content">
        <TopBar
          workspaceName={data.workspaceName}
          timeRange={data.timeRange}
          connected={data.connection.connected}
          generatedAt={data.generatedAt}
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
