interface MetricCardProps {
  label: string;
  value: string;
  trend?: string;
}

export function MetricCard({ label, value, trend }: MetricCardProps) {
  return (
    <article className="metric-card">
      <p>{label}</p>
      <h3>{value}</h3>
      {trend ? <span>{trend}</span> : null}
    </article>
  );
}