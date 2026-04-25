import type { DashboardData } from "../types";

export function AgentsView({ data }: { data: DashboardData }) {
  return (
    <section className="view">
      <article className="panel">
        <h3>Agent Health</h3>
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Status</th>
              <th>Active Run</th>
              <th>Risk Score</th>
              <th>Stale Memory</th>
              <th>Open Alerts</th>
            </tr>
          </thead>
          <tbody>
            {data.agents.map((agent) => (
              <tr key={agent.agentId}>
                <td>{agent.name}</td>
                <td>{agent.status}</td>
                <td>{agent.activeRunId ?? "-"}</td>
                <td>{agent.riskScore.toFixed(2)}</td>
                <td>{agent.staleMemoryCount}</td>
                <td>{agent.openAlerts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}