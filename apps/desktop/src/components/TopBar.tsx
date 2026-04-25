interface TopBarProps {
  workspaceName: string;
  timeRange: string;
}

export function TopBar({ workspaceName, timeRange }: TopBarProps) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Workspace</p>
        <h2>{workspaceName}</h2>
      </div>
      <div className="topbar-meta">
        <span className="pill">{timeRange}</span>
        <span className="pill">Local-first mode</span>
      </div>
    </header>
  );
}