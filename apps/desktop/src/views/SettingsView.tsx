import type { DashboardData } from "../types";

export function SettingsView({ data }: { data: DashboardData }) {
  return (
    <section className="view">
      <div className="panel-grid">
        <article className="panel">
          <h3>Connector Management</h3>
          <table>
            <thead>
              <tr>
                <th>Connector</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Last Sync</th>
              </tr>
            </thead>
            <tbody>
              {data.connectors.map((connector) => (
                <tr key={connector.connectorId}>
                  <td>{connector.connectorId}</td>
                  <td>{connector.scope}</td>
                  <td>{connector.status}</td>
                  <td>{new Date(connector.lastSync).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
        <article className="panel">
          <h3>Trust Defaults</h3>
          <ul>
            <li>Local-first processing enabled.</li>
            <li>Cloud sync disabled by default.</li>
            <li>Sensitive data redaction enabled for exports.</li>
            <li>Permission recertification interval: 30 days.</li>
          </ul>
        </article>
      </div>
    </section>
  );
}