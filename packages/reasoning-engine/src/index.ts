import type {
  ReasoningAlert,
  ReasoningAlertCategory,
  RunSnapshot,
  Severity,
  WorkflowEvent
} from "@theia/event-schema";

export interface DetectionOptions {
  minLoopRepetition?: number;
  staleMemoryWindowMinutes?: number;
}

const DEFAULT_OPTIONS: Required<DetectionOptions> = {
  minLoopRepetition: 3,
  staleMemoryWindowMinutes: 15
};

const SEVERITY_BY_CATEGORY: Record<ReasoningAlertCategory, Severity> = {
  unsupported_assumption: "medium",
  stale_memory: "medium",
  contradiction: "high",
  hallucination_risk: "high",
  evidence_gap: "medium",
  loop_behavior: "low",
  tool_mismatch: "high",
  overconfidence_without_verification: "medium",
  task_drift: "medium",
  unsafe_automation_escalation: "critical"
};

const TITLE_BY_CATEGORY: Record<ReasoningAlertCategory, string> = {
  unsupported_assumption: "Unsupported assumption detected",
  stale_memory: "Potential stale-memory dependence",
  contradiction: "Contradiction with prior conclusion",
  hallucination_risk: "Potential hallucination risk",
  evidence_gap: "Evidence gap before conclusion",
  loop_behavior: "Repeated loop behavior detected",
  tool_mismatch: "Tool-result mismatch",
  overconfidence_without_verification: "Overconfidence without verification",
  task_drift: "Task drift from run objective",
  unsafe_automation_escalation: "Unsafe automation escalation"
};

function hashSeed(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

function confidenceBand(confidence: number): "low" | "medium" | "high" {
  if (confidence < 0.45) return "low";
  if (confidence < 0.75) return "medium";
  return "high";
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenSet(input: string): Set<string> {
  return new Set(normalizeText(input).split(" ").filter((token) => token.length > 2));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((v) => b.has(v)));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

function getEventText(event: WorkflowEvent): string {
  const payloadText = typeof event.payload.text === "string" ? event.payload.text : "";
  const summaryText = typeof event.payload.summary === "string" ? event.payload.summary : "";
  return [payloadText, summaryText].filter(Boolean).join(" ").trim();
}

function buildAlert(
  snapshot: RunSnapshot,
  event: WorkflowEvent,
  category: ReasoningAlertCategory,
  confidence: number,
  explanation: string
): ReasoningAlert {
  const createdAt = event.timestamp;
  const alertId = `alert_${category}_${hashSeed(`${snapshot.run.runId}:${event.eventId}:${category}`)}`;

  return {
    alertId,
    workspaceId: snapshot.run.workspaceId,
    runId: snapshot.run.runId,
    agentId: snapshot.run.agentId,
    category,
    severity: SEVERITY_BY_CATEGORY[category],
    confidence,
    confidenceBand: confidenceBand(confidence),
    status: "open",
    title: TITLE_BY_CATEGORY[category],
    explanation,
    evidenceRefs: [
      {
        eventId: event.eventId,
        source: event.source,
        excerpt: getEventText(event)
      }
    ],
    createdAt,
    updatedAt: createdAt
  };
}

function detectUnsupportedAssumptions(snapshot: RunSnapshot): ReasoningAlert[] {
  return snapshot.events
    .filter((event) => event.eventType === "reasoning.claim")
    .filter((event) => {
      const text = getEventText(event);
      const assumptionFlag = Boolean(event.payload.assumption);
      const hasNoEvidence = event.evidenceRefs.length === 0;
      return hasNoEvidence && (assumptionFlag || /\bassum(e|ing|ption)\b/i.test(text));
    })
    .map((event) =>
      buildAlert(
        snapshot,
        event,
        "unsupported_assumption",
        0.74,
        "This claim appears to rely on an assumption without linked memory or tool evidence."
      )
    );
}

function detectStaleMemory(snapshot: RunSnapshot): ReasoningAlert[] {
  const latestVersionByMemoryId = new Map<string, { versionId: string; createdAt: number }>();
  for (const version of snapshot.memoryVersions) {
    const ts = new Date(version.createdAt).getTime();
    const current = latestVersionByMemoryId.get(version.memoryId);
    if (!current || ts > current.createdAt) {
      latestVersionByMemoryId.set(version.memoryId, { versionId: version.versionId, createdAt: ts });
    }
  }

  const alerts: ReasoningAlert[] = [];
  for (const event of snapshot.events) {
    const memoryVersionId = typeof event.payload.memoryVersionId === "string" ? event.payload.memoryVersionId : undefined;
    const memoryId = typeof event.payload.memoryId === "string" ? event.payload.memoryId : undefined;
    if (!memoryVersionId || !memoryId) {
      continue;
    }

    const latest = latestVersionByMemoryId.get(memoryId);
    if (!latest || latest.versionId === memoryVersionId) {
      continue;
    }

    alerts.push(
      buildAlert(
        snapshot,
        event,
        "stale_memory",
        0.81,
        `The step references memory version ${memoryVersionId}, but a newer version (${latest.versionId}) exists.`
      )
    );
  }

  return alerts;
}

function detectContradictions(snapshot: RunSnapshot): ReasoningAlert[] {
  const conclusions = snapshot.events.filter((event) => event.eventType === "reasoning.conclusion");
  const alerts: ReasoningAlert[] = [];

  for (let i = 1; i < conclusions.length; i += 1) {
    const current = conclusions[i];
    const prior = conclusions[i - 1];
    if (!current || !prior) continue;

    const a = normalizeText(getEventText(current));
    const b = normalizeText(getEventText(prior));

    if (!a || !b) continue;

    const aWithoutNot = a.replace(/\bnot\b/g, "").replace(/\s+/g, " ").trim();
    const bWithoutNot = b.replace(/\bnot\b/g, "").replace(/\s+/g, " ").trim();

    const hasOpposingNegation = a.includes(" not ") !== b.includes(" not ");
    const nearSameClaim = aWithoutNot === bWithoutNot || jaccardSimilarity(tokenSet(aWithoutNot), tokenSet(bWithoutNot)) > 0.82;

    if (hasOpposingNegation && nearSameClaim) {
      alerts.push(
        buildAlert(
          snapshot,
          current,
          "contradiction",
          0.88,
          "This conclusion appears to conflict with a prior conclusion in the same run."
        )
      );
    }
  }

  return alerts;
}

function detectHallucinationRisk(snapshot: RunSnapshot): ReasoningAlert[] {
  return snapshot.events
    .filter((event) => event.eventType === "reasoning.conclusion")
    .filter((event) => {
      const text = getEventText(event);
      const hasSpecificity = /\b\d{4}\b/.test(text) || /\baccording to\b/i.test(text) || /\bpercent\b/i.test(text);
      return hasSpecificity && event.evidenceRefs.length === 0;
    })
    .map((event) =>
      buildAlert(
        snapshot,
        event,
        "hallucination_risk",
        0.79,
        "The conclusion includes specific factual language without linked evidence in accessible sources."
      )
    );
}

function detectEvidenceGaps(snapshot: RunSnapshot): ReasoningAlert[] {
  const latestToolTimestamp = Math.max(
    0,
    ...snapshot.events
      .filter((event) => event.eventType === "tool_call.completed")
      .map((event) => new Date(event.timestamp).getTime())
  );

  return snapshot.events
    .filter((event) => event.eventType === "reasoning.conclusion")
    .filter((event) => {
      const eventTs = new Date(event.timestamp).getTime();
      const hasEvidence = event.evidenceRefs.length > 0;
      return !hasEvidence && latestToolTimestamp > 0 && eventTs >= latestToolTimestamp;
    })
    .map((event) =>
      buildAlert(
        snapshot,
        event,
        "evidence_gap",
        0.72,
        "A conclusion was produced without citing evidence, despite tool activity in this run."
      )
    );
}

function detectLoopBehavior(snapshot: RunSnapshot, threshold: number): ReasoningAlert[] {
  const counts = new Map<string, { count: number; event: WorkflowEvent }>();

  for (const event of snapshot.events) {
    const signature = `${event.eventType}:${JSON.stringify(event.payload)}`;
    const existing = counts.get(signature);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(signature, { count: 1, event });
    }
  }

  return [...counts.values()]
    .filter((entry) => entry.count > threshold)
    .map((entry) =>
      buildAlert(
        snapshot,
        entry.event,
        "loop_behavior",
        Math.min(0.5 + entry.count * 0.08, 0.9),
        `Detected ${entry.count} repeated events with minimal variation, which may indicate looping behavior.`
      )
    );
}

function detectToolMismatch(snapshot: RunSnapshot): ReasoningAlert[] {
  const failedToolEvents = snapshot.events.filter((event) => {
    if (event.eventType !== "tool_call.completed" && event.eventType !== "tool_call.failed") return false;
    const text = JSON.stringify(event.payload).toLowerCase();
    return text.includes("error") || text.includes("failed");
  });

  const conclusionEvents = snapshot.events.filter((event) => event.eventType === "reasoning.conclusion");
  const alerts: ReasoningAlert[] = [];

  for (const conclusion of conclusionEvents) {
    const conclusionText = getEventText(conclusion).toLowerCase();
    if (!/\bsuccess|completed|resolved\b/i.test(conclusionText)) {
      continue;
    }

    const mismatchSource = failedToolEvents.find(
      (toolEvent) => new Date(toolEvent.timestamp).getTime() <= new Date(conclusion.timestamp).getTime()
    );

    if (!mismatchSource) continue;

    alerts.push(
      buildAlert(
        snapshot,
        conclusion,
        "tool_mismatch",
        0.84,
        "The conclusion suggests success, but recent tool output indicates failure/error signals."
      )
    );
  }

  return alerts;
}

function detectOverconfidence(snapshot: RunSnapshot): ReasoningAlert[] {
  const hasVerification = snapshot.events.some((event) =>
    ["tool_call.completed", "approval.granted", "checkpoint.created"].includes(event.eventType)
  );

  return snapshot.events
    .filter((event) => event.eventType === "reasoning.conclusion")
    .filter((event) => /\b(definitely|certainly|guaranteed|always)\b/i.test(getEventText(event)))
    .filter(() => !hasVerification)
    .map((event) =>
      buildAlert(
        snapshot,
        event,
        "overconfidence_without_verification",
        0.69,
        "High-certainty language appears without verification checkpoints or corroborating evidence."
      )
    );
}

function detectTaskDrift(snapshot: RunSnapshot): ReasoningAlert[] {
  const objectiveTokens = tokenSet(snapshot.run.objective);
  if (objectiveTokens.size === 0) return [];

  return snapshot.events
    .filter((event) => event.eventType === "reasoning.claim" || event.eventType === "reasoning.conclusion")
    .map((event) => {
      const similarity = jaccardSimilarity(objectiveTokens, tokenSet(getEventText(event)));
      return { event, similarity };
    })
    .filter((entry) => entry.similarity < 0.1)
    .map((entry) =>
      buildAlert(
        snapshot,
        entry.event,
        "task_drift",
        0.63,
        `This step has low semantic alignment with the run objective (similarity=${entry.similarity.toFixed(2)}).`
      )
    );
}

function detectUnsafeEscalation(snapshot: RunSnapshot): ReasoningAlert[] {
  const approvalGrantedAt = Math.max(
    0,
    ...snapshot.events
      .filter((event) => event.eventType === "approval.granted")
      .map((event) => new Date(event.timestamp).getTime())
  );

  return snapshot.events
    .filter((event) => event.eventType === "privileged_action.attempted")
    .filter((event) => new Date(event.timestamp).getTime() > approvalGrantedAt)
    .map((event) =>
      buildAlert(
        snapshot,
        event,
        "unsafe_automation_escalation",
        0.92,
        "A privileged action was attempted without a preceding approval grant in this run context."
      )
    );
}

export function evaluateRun(snapshot: RunSnapshot, options?: DetectionOptions): ReasoningAlert[] {
  const resolved = { ...DEFAULT_OPTIONS, ...options };

  const alerts = [
    ...detectUnsupportedAssumptions(snapshot),
    ...detectStaleMemory(snapshot),
    ...detectContradictions(snapshot),
    ...detectHallucinationRisk(snapshot),
    ...detectEvidenceGaps(snapshot),
    ...detectLoopBehavior(snapshot, resolved.minLoopRepetition),
    ...detectToolMismatch(snapshot),
    ...detectOverconfidence(snapshot),
    ...detectTaskDrift(snapshot),
    ...detectUnsafeEscalation(snapshot)
  ];

  const unique = new Map<string, ReasoningAlert>();
  for (const alert of alerts) {
    unique.set(alert.alertId, alert);
  }

  return [...unique.values()].sort((a, b) => b.confidence - a.confidence);
}