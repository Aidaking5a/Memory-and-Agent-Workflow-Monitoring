import type { DashboardData } from "../types";

export function AgentsView({ data }: { data: DashboardData }) {
  return (
    <section className="view">
      <article className="panel">
        <h3>Agent Health</h3>
        {data.agents.length === 0 ? <p className="muted-note">No agents observed yet. Connect workflow sources to start monitoring.</p> : null}
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Status</th>
              <th>Active Run</th>
              <th>Risk Score</th>
              <th>Workload</th>
              <th>Token Burn (24h)</th>
              <th>Memory Freshness</th>
              <th>Open Alerts</th>
              <th>Objective</th>
            </tr>
          </thead>
          <tbody>
            {data.agents.map((agent) => (
              <tr key={agent.agentId}>
                <td>{agent.name}</td>
                <td>{agent.status}</td>
                <td>{agent.activeRunId ?? "-"}</td>
                <td>{Math.round(agent.riskScore * 100)}%</td>
                <td>{Math.round(agent.workloadPressure * 100)}%</td>
                <td>{agent.tokens24h.toLocaleString()}</td>
                <td>{Math.round(agent.memoryFreshness * 100)}%</td>
                <td>{agent.openAlerts}</td>
                <td>{agent.currentObjective ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}
