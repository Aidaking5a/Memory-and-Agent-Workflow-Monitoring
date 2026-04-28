import { describe, expect, it } from "vitest";
import type { RunSnapshot } from "@theia/event-schema";
import { evaluateRun } from "./index.js";

function baseSnapshot(): RunSnapshot {
  return {
    run: {
      runId: "run_1",
      workspaceId: "ws_1",
      agentId: "agent_1",
      objective: "Validate memory consistency before publishing updates",
      status: "running",
      startedAt: "2026-01-01T00:00:00Z"
    },
    tasks: [],
    memoryVersions: [],
    workflowCandidates: [],
    events: [
      {
        eventId: "evt_1",
        workspaceId: "ws_1",
        agentId: "agent_1",
        runId: "run_1",
        eventType: "reasoning.claim",
        timestamp: "2026-01-01T00:01:00Z",
        payload: { text: "Assuming the old memory is still valid", assumption: true },
        source: { connectorId: "local" },
        evidenceRefs: []
      },
      {
        eventId: "evt_2",
        workspaceId: "ws_1",
        agentId: "agent_1",
        runId: "run_1",
        eventType: "reasoning.conclusion",
        timestamp: "2026-01-01T00:02:00Z",
        payload: { text: "This is definitely complete" },
        source: { connectorId: "local" },
        evidenceRefs: []
      }
    ]
  };
}

describe("evaluateRun", () => {
  it("raises alerts for unsupported assumptions and overconfidence patterns", () => {
    const alerts = evaluateRun(baseSnapshot());
    expect(alerts.some((alert) => alert.category === "unsupported_assumption")).toBe(true);
    expect(alerts.some((alert) => alert.category === "overconfidence_without_verification")).toBe(true);
  });

  it("raises workflow hardening alerts for context mismatch and promotion failures", () => {
    const snapshot = baseSnapshot();
    snapshot.events.push(
      {
        eventId: "evt_3",
        workspaceId: "ws_1",
        agentId: "agent_1",
        runId: "run_1",
        eventType: "workflow.derived_decision",
        timestamp: "2026-01-01T00:03:00Z",
        payload: {
          workflowTitle: "Legacy browser checkout workflow",
          workflowObjective: "Checkout flow for ecommerce web session",
          contextShiftScore: 0.81,
          domainChanged: true
        },
        source: { connectorId: "local" },
        evidenceRefs: []
      },
      {
        eventId: "evt_4",
        workspaceId: "ws_1",
        agentId: "agent_1",
        runId: "run_1",
        eventType: "workflow.rejected",
        timestamp: "2026-01-01T00:04:00Z",
        payload: {
          workflowId: "wf_1",
          gateFailures: ["min_confidence", "min_tool_grounding"]
        },
        source: { connectorId: "local" },
        evidenceRefs: []
      }
    );

    const alerts = evaluateRun(snapshot);
    expect(alerts.some((alert) => alert.category === "workflow_context_mismatch")).toBe(true);
    expect(alerts.some((alert) => alert.category === "workflow_promotion_gate_failed")).toBe(true);
  });
});
