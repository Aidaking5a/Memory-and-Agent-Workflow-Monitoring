import { AlertOctagon, Bell, Plus, Search } from "lucide-react";
import { TheiaEyeMark } from "./TheiaEyeMark";

interface TopBarProps {
  workspaceName: string;
  timeRange: string;
  connected: boolean;
  generatedAt?: string;
  signedInEmail?: string | null;
  onSignOut?: () => void;
  onAddAgent?: () => void;
  onEmergencyStop?: () => void;
  notificationCount?: number;
}

export function TopBar({
  workspaceName,
  timeRange,
  connected,
  generatedAt,
  signedInEmail,
  onSignOut,
  onAddAgent,
  onEmergencyStop,
  notificationCount = 0
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-main">
        <TheiaEyeMark size={28} />
        <div>
          <p className="eyebrow">Command Center</p>
          <h2>{workspaceName}</h2>
        </div>
      </div>
      <label className="topbar-search">
        <Search size={15} />
        <input aria-label="Search agents and activity" placeholder="Search agents, tools, tasks..." />
      </label>
      <div className="topbar-meta">
        <span className="pill">{timeRange}</span>
        <span className={connected ? "pill pill-live" : "pill"}>{connected ? "Connected" : "Not Connected"}</span>
      </div>
      <div className="topbar-status">
        <span className={connected ? "status-dot" : "status-dot status-dot-offline"} />
        <strong>{generatedAt ? `Synced ${new Date(generatedAt).toLocaleTimeString()}` : "Awaiting sync"}</strong>
      </div>
      <div className="topbar-actions" aria-label="Command center actions">
        <button className="action-btn neutral" type="button" onClick={onAddAgent}>
          <Plus size={14} />
          Add Agent
        </button>
        <button className="notification-btn" type="button" aria-label={`${notificationCount} notifications`}>
          <Bell size={15} />
          <span>{notificationCount}</span>
        </button>
        <button className="action-btn danger" type="button" onClick={onEmergencyStop}>
          <AlertOctagon size={14} />
          Stop All
        </button>
      </div>
      <div className="topbar-auth">
        <span>{signedInEmail ?? "Not signed in"}</span>
        {onSignOut ? (
          <button className="action-btn neutral" type="button" onClick={onSignOut}>
            Logout
          </button>
        ) : null}
      </div>
    </header>
  );
}
