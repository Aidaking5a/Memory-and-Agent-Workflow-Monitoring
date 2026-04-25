import { useEffect, useMemo, useState } from "react";
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

const VIEW_LABELS: Record<ViewKey, string> = {
  overview: "Overview Dashboard",
  agents: "Agent List and Health",
  timeline: "Workflow Timeline",
  memory: "Memory Explorer",
  alerts: "Reasoning Alert Center",
  compare: "Agent Comparison",
  audit: "Audit and Permissions",
  settings: "Settings and Connectors"
};

export function App() {
  const [view, setView] = useState<ViewKey>("overview");
  const [data, setData] = useState<DashboardData>(mockData);

  useEffect(() => {
    void loadDashboardData().then(setData);
  }, []);

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
      case "compare":
        return <CompareView data={data} />;
      case "audit":
        return <AuditView data={data} />;
      case "settings":
        return <SettingsView data={data} />;
      default:
        return <OverviewView data={data} />;
    }
  }, [data, view]);

  return (
    <div className="app-shell">
      <Sidebar current={view} onSelect={setView} />
      <main className="content">
        <TopBar workspaceName={data.workspaceName} timeRange={data.timeRange} />
        <section className="view-header">
          <h2>{VIEW_LABELS[view]}</h2>
          <p>Transparent observability for memory, workflow state, and reasoning quality.</p>
        </section>
        {body}
      </main>
    </div>
  );
}