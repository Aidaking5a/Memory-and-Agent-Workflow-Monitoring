import type { DashboardData } from "../types";

export function CompareView({ data }: { data: DashboardData }) {
  return (
    <section className="view">
      <article className="panel">
        <h3>Agent Comparison</h3>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Alpha</th>
              <th>Beta</th>
            </tr>
          </thead>
          <tbody>
            {data.comparison.map((row) => (
              <tr key={row.metric}>
                <td>{row.metric}</td>
                <td>{row.alphaAgent}</td>
                <td>{row.betaAgent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}