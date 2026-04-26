import { useCallback, useEffect, useMemo, useState } from "react";
import { loadDashboardData } from "./api";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { mockData } from "./mock-data";
import type { DashboardData, ViewKey } from "./types";
import { AgentsView } from "./views/AgentsView";
import { AlertsView } from "./views/AlertsView";
import { AuditView } from "./views/AuditView";
import { CompareView } from "./views/CompareView";
import { MemoryView } from "./views/MemoryView";
import { OverviewView } from "./views/OverviewView";
import { SettingsView } from "./views/SettingsView";
import { TimelineView } from "./views/TimelineView";
import { WorkflowGovernanceView } from "./views/WorkflowGovernanceView";

const VIEW_LABELS: Record<ViewKey, string> = {
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
  const [data, setData] = useState<DashboardData>(mockData);
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

  const body = useMemo(() => {
    switch (view) {
      case "overview":
        return <OverviewView data={data} />;
      case "agents":
        return <AgentsView data={data} />;
      case "timeline":
        return <TimelineView data={data} />;
      case "memory":
        return <MemoryView data={data} />;
      case "alerts":
        return <AlertsView data={data} />;
      case "governance":
        return <WorkflowGovernanceView data={data} onRefresh={refreshData} isRefreshing={isRefreshing} />;
      case "compare":
        return <CompareView data={data} />;
      case "audit":
        return <AuditView data={data} />;
      case "settings":
        return <SettingsView data={data} />;
      default:
        return <OverviewView data={data} />;
    }
  }, [data, isRefreshing, refreshData, view]);

  return (
    <div className="app-shell">
      <Sidebar current={view} onSelect={setView} />
      <main className="content">
        <TopBar workspaceName={data.workspaceName} timeRange={data.timeRange} />
        <section className="view-header">
          <h2>{VIEW_LABELS[view]}</h2>
          <p>High-signal control surface for memory integrity, workflow governance, and operator decisions.</p>
        </section>
        {body}
      </main>
    </div>
  );
}
