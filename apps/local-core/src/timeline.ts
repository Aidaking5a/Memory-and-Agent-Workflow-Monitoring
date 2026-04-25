import type { WorkflowEvent } from "@theia/event-schema";

export interface TimelineNode {
  id: string;
  ts: string;
  type: string;
  label: string;
  eventId: string;
}

export interface TimelineEdge {
  from: string;
  to: string;
  relation: "sequence" | "depends_on" | "evidence_for";
}

export interface WorkflowTimeline {
  runId: string;
  nodes: TimelineNode[];
  edges: TimelineEdge[];
}

export function buildTimeline(runId: string, events: WorkflowEvent[]): WorkflowTimeline {
  const ordered = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const nodes: TimelineNode[] = ordered.map((event, index) => ({
    id: `n_${index + 1}`,
    ts: event.timestamp,
    type: event.eventType,
    label: event.eventType,
    eventId: event.eventId
  }));

  const eventNode = new Map<string, string>();
  nodes.forEach((node) => eventNode.set(node.eventId, node.id));

  const edges: TimelineEdge[] = [];
  for (let i = 1; i < nodes.length; i += 1) {
    const prior = nodes[i - 1];
    const current = nodes[i];
    if (prior && current) {
      edges.push({ from: prior.id, to: current.id, relation: "sequence" });
    }
  }

  for (const event of ordered) {
    const fromNodeId = eventNode.get(event.eventId);
    if (!fromNodeId) continue;

    for (const evidence of event.evidenceRefs) {
      if (!evidence.eventId) continue;
      const toNodeId = eventNode.get(evidence.eventId);
      if (!toNodeId) continue;
      edges.push({ from: toNodeId, to: fromNodeId, relation: "evidence_for" });
    }
  }

  return {
    runId,
    nodes,
    edges
  };
}