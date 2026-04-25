import { SeverityBadge } from "../components/SeverityBadge";
import type { DashboardData } from "../types";

export function AlertsView({ data }: { data: DashboardData }) {
  return (
    <section className="view">
      <article className="panel">
        <h3>Reasoning Alert Center</h3>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Severity</th>
              <th>Confidence</th>
              <th>Title</th>
              <th>Explanation</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.alerts.map((alert) => (
              <tr key={alert.alertId}>
                <td>{alert.category}</td>
                <td>
                  <SeverityBadge severity={alert.severity} />
                </td>
                <td>{alert.confidence.toFixed(2)}</td>
                <td>{alert.title}</td>
                <td>{alert.explanation}</td>
                <td>{alert.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}