import type { DashboardData } from "../types";

export function TimelineView({ data }: { data: DashboardData }) {
  return (
    <section className="view">
      <article className="panel">
        <h3>Workflow Timeline</h3>
        <div className="timeline">
          {data.timeline.map((item) => (
            <div className="timeline-item" key={item.eventId}>
              <div>
                <p className="timeline-type">{item.eventType}</p>
                <p>{item.summary}</p>
                <small>{item.agent}</small>
              </div>
              <time>{new Date(item.ts).toLocaleString()}</time>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}