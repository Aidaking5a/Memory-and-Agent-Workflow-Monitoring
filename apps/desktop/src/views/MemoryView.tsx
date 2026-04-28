import type { DashboardData } from "../types";

export function MemoryView({ data }: { data: DashboardData }) {
  return (
    <section className="view">
      <div className="panel-grid">
        <article className="panel">
          <h3>Memory Explorer</h3>
          {data.memory.length === 0 ? (
            <p className="muted-note">No memory sections available. Configure memory.md/bootstrap.md in onboarding.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Section</th>
                  <th>Latest Version</th>
                  <th>Preview</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.memory.map((memory) => (
                  <tr key={memory.memoryId}>
                    <td>{memory.sourcePath}</td>
                    <td>{memory.heading}</td>
                    <td>{memory.latestVersionId}</td>
                    <td>{memory.contentPreview || "-"}</td>
                    <td>{memory.updatedAt ? new Date(memory.updatedAt).toLocaleString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
        <article className="panel">
          <h3>Recent Memory Changes</h3>
          <ul className="dense-list">
            {data.memoryChanges.length === 0 ? <li>No recent memory changes detected.</li> : null}
            {data.memoryChanges.map((change) => (
              <li key={change.eventId}>
                <strong>{new Date(change.ts).toLocaleString()}</strong> - {change.summary} ({change.sourcePath})
              </li>
            ))}
          </ul>
        </article>
      </div>
      <article className="panel">
        <h3>Memory-to-Reasoning Impact</h3>
        {data.memoryImpactLinks.length === 0 ? (
          <p className="muted-note">No explicit memory impact links detected yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Alert</th>
                <th>Category</th>
                <th>Severity</th>
                <th>Run</th>
                <th>Source</th>
                <th>Section</th>
                <th>Explanation</th>
              </tr>
            </thead>
            <tbody>
              {data.memoryImpactLinks.map((link) => (
                <tr key={`${link.alertId}-${link.sectionKey}`}>
                  <td>{link.alertId}</td>
                  <td>{link.category}</td>
                  <td>{link.severity}</td>
                  <td>{link.runId}</td>
                  <td>{link.sourcePath}</td>
                  <td>{link.sectionKey}</td>
                  <td>{link.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </section>
  );
}
