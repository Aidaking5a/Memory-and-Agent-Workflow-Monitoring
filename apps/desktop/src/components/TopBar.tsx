import { TheiaEyeMark } from "./TheiaEyeMark";

interface TopBarProps {
  workspaceName: string;
  timeRange: string;
  connected: boolean;
  generatedAt?: string;
}

export function TopBar({ workspaceName, timeRange, connected, generatedAt }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-main">
        <TheiaEyeMark size={28} />
        <div>
          <p className="eyebrow">Workspace</p>
          <h2>{workspaceName}</h2>
        </div>
      </div>
      <div className="topbar-meta">
        <span className="pill">{timeRange}</span>
        <span className={connected ? "pill pill-live" : "pill"}>{connected ? "Connected" : "Not Connected"}</span>
      </div>
      <div className="topbar-status">
        <span className={connected ? "status-dot" : "status-dot status-dot-offline"} />
        <strong>{generatedAt ? `Synced ${new Date(generatedAt).toLocaleTimeString()}` : "Awaiting sync"}</strong>
      </div>
    </header>
  );
}
