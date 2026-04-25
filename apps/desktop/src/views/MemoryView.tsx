import type { DashboardData } from "../types";

export function MemoryView({ data }: { data: DashboardData }) {
  return (
    <section className="view">
      <article className="panel">
        <h3>Memory Explorer</h3>
        <table>
          <thead>
            <tr>
              <th>Memory ID</th>
              <th>Source</th>
              <th>Section</th>
              <th>Latest Version</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {data.memory.map((memory) => (
              <tr key={memory.memoryId}>
                <td>{memory.memoryId}</td>
                <td>{memory.sourcePath}</td>
                <td>{memory.sectionKey}</td>
                <td>{memory.latestVersionId}</td>
                <td>{new Date(memory.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}