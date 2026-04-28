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
          <ul className="dense-list">
            <li>Workspace access granted: {data.connection.permissions.workspaceAccessGranted ? "yes" : "no"}</li>
            <li>Memory file access: {data.connection.permissions.readMemoryFiles ? "yes" : "no"}</li>
            <li>Workflow event access: {data.connection.permissions.readWorkflowEvents ? "yes" : "no"}</li>
            <li>Prompt metadata access: {data.connection.permissions.readPrompts ? "yes" : "no"}</li>
            <li>Operator role: {data.operator.role}</li>
            <li>Operator capabilities: {data.operator.capabilities.length > 0 ? data.operator.capabilities.join(", ") : "read-only"}</li>
            <li>Immutable audit chain remains active for all connector and governance actions.</li>
          </ul>
        </article>
      </div>
    </section>
  );
}
