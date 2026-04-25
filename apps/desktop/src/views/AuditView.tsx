import type { DashboardData } from "../types";

export function AuditView({ data }: { data: DashboardData }) {
  return (
    <section className="view">
      <div className="panel-grid">
        <article className="panel">
          <h3>Audit Log</h3>
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {data.audit.map((item, index) => (
                <tr key={`${item.ts}-${index}`}>
                  <td>{new Date(item.ts).toLocaleString()}</td>
                  <td>{item.actor}</td>
                  <td>{item.action}</td>
                  <td>{item.target}</td>
                  <td>{item.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
        <article className="panel">
          <h3>Permission Controls</h3>
          <ul>
            <li>Grant scopes per connector and per path.</li>
            <li>Require explicit approval for privileged automation actions.</li>
            <li>Maintain immutable audit chain for every permission mutation.</li>
          </ul>
        </article>
      </div>
    </section>
  );
}