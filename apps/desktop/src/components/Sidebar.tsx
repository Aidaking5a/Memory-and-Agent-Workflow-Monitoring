import type { ViewKey } from "../types";

interface SidebarProps {
  current: ViewKey;
  onSelect: (view: ViewKey) => void;
}

const NAV_ITEMS: Array<{ key: ViewKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "agents", label: "Agent Health" },
  { key: "timeline", label: "Workflow Timeline" },
  { key: "memory", label: "Memory Explorer" },
  { key: "alerts", label: "Reasoning Alerts" },
  { key: "compare", label: "Agent Comparison" },
  { key: "audit", label: "Audit & Permissions" },
  { key: "settings", label: "Settings" }
];

export function Sidebar({ current, onSelect }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">TH</div>
        <div>
          <h1>Theia</h1>
          <p>Control Center</p>
        </div>
      </div>
      <nav>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            className={item.key === current ? "nav-button active" : "nav-button"}
            onClick={() => onSelect(item.key)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}