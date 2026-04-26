interface MetricCardProps {
  label: string;
  value: string;
  trend?: string;
}

export function MetricCard({ label, value, trend }: MetricCardProps) {
  const trendClass = trend
    ? trend.startsWith("+")
      ? "metric-trend up"
      : trend.startsWith("-")
        ? "metric-trend down"
        : "metric-trend"
    : "metric-trend";

  return (
    <article className="metric-card">
      <p className="metric-label">{label}</p>
      <h3>{value}</h3>
      {trend ? <span className={trendClass}>{trend}</span> : <span className="metric-trend muted">No trend</span>}
    </article>
  );
}
