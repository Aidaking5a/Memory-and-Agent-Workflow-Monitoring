import { TheiaEyeMark } from "./TheiaEyeMark";

interface TopBarProps {
  workspaceName: string;
  timeRange: string;
}

export function TopBar({ workspaceName, timeRange }: TopBarProps) {
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
        <span className="pill pill-live">Local-first mode</span>
      </div>
      <div className="topbar-status">
        <span className="status-dot" />
        <strong>Operator Focus</strong>
      </div>
    </header>
  );
}
