import type { ViewKey } from "../types";
import { TheiaEyeMark } from "./TheiaEyeMark";

interface SidebarProps {
  current: ViewKey;
  onSelect: (view: ViewKey) => void;
}

const NAV_ITEMS: Array<{ key: ViewKey; label: string; meta: string; glyph: string }> = [
  { key: "dashboard", label: "Overview", meta: "Command Surface", glyph: "OVR" },
  { key: "network", label: "Network", meta: "Live Infographic", glyph: "NET" },
  { key: "cards", label: "Agent Cards", meta: "Card Directory", glyph: "AGT" },
  { key: "activity", label: "Operator Cards", meta: "Activity Briefs", glyph: "ACT" },
  { key: "costs", label: "Costs", meta: "Usage & Budgets", glyph: "USD" },
  { key: "security", label: "Security", meta: "Audit & Safety", glyph: "SEC" },
  { key: "settings", label: "Settings", meta: "Connections", glyph: "CFG" },
  { key: "help", label: "Help", meta: "Guides & Support", glyph: "HLP" }
];

export function Sidebar({ current, onSelect }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <TheiaEyeMark size={34} />
        </div>
        <div>
          <h1>Theia</h1>
          <p>Agent Command Center</p>
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
            <span className="nav-glyph">{item.glyph}</span>
            <span className="nav-copy">
              <strong>{item.label}</strong>
              <small>{item.meta}</small>
            </span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
