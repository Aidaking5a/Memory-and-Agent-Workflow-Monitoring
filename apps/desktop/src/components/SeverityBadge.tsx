export function SeverityBadge({ severity }: { severity: "info" | "low" | "medium" | "high" | "critical" }) {
  return <span className={`severity ${severity}`}>{severity}</span>;
}