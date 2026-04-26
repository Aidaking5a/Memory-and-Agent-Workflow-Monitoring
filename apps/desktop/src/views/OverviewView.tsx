import type { DashboardData } from "../types";
import { MetricCard } from "../components/MetricCard";

export function OverviewView({ data }: { data: DashboardData }) {
  return (
    <section className="view">
      <div className="metrics-grid">
        {data.metrics.map((metric) => (
          <MetricCard key={metric.label} label={metric.label} value={metric.value} trend={metric.trend} />
        ))}
      </div>
      <div className="panel-grid">
        <article className="panel">
          <h3>Operational Snapshot</h3>
          <p>
            Theia provides a transparent, permission-based view of active runs, memory revisions, and reasoning risk
            concentration for rapid human review.
          </p>
          <ul>
            <li>Most alerts currently originate from evidence-gap and stale-memory categories.</li>
            <li>Connector health is stable with one degraded stream requiring inspection.</li>
            <li>
              Workflow gate queue: {data.workflowReport.pendingReviewCandidates} pending review,{" "}
              {data.workflowReport.conflictOpenCount} open compatibility conflicts.
            </li>
          </ul>
        </article>
        <article className="panel">
          <h3>Trust Indicators</h3>
          <ul>
            <li>Explicit connector scopes are displayed and revocable.</li>
            <li>All agent steps are linked to evidence references where available.</li>
            <li>Audit trail entries are immutable and export-ready.</li>
          </ul>
        </article>
      </div>
    </section>
  );
}
