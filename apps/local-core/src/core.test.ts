import { describe, expect, it } from "vitest";
import type { WorkflowEvent } from "@theia/event-schema";
import { TheiaCore } from "./core.js";

function makeEvent(input: {
  eventId: string;
  runId: string;
  agentId: string;
  eventType: WorkflowEvent["eventType"];
  payload?: Record<string, unknown>;
  confidence?: number;
  evidenceRefs?: WorkflowEvent["evidenceRefs"];
}): WorkflowEvent {
  return {
    eventId: input.eventId,
    workspaceId: "ws_test",
    agentId: input.agentId,
    runId: input.runId,
    eventType: input.eventType,
    timestamp: new Date().toISOString(),
    payload: input.payload ?? {},
    source: {
      connectorId: "test"
    },
    confidence: input.confidence,
    evidenceRefs: input.evidenceRefs ?? []
  };
}

describe("TheiaCore workflow governance", () => {
  function buildCore() {
    return new TheiaCore({
      workspaceId: "ws_test",
      approvedPaths: [process.cwd()],
      fileSources: [],
      codexLogSources: [],
      customJsonSources: [],
      openClawSources: [],
      workflowPolicy: {
        minEvidencePacketCount: 1
      }
    });
  }

  it("promotes a healthy workflow candidate when release gates pass", () => {
    const core = buildCore();
    const run = core.createRun("Ship observability dashboard with verification", "agt_alpha");

    core.addEvent(
      makeEvent({
        eventId: "evt_tool_1",
        runId: run.runId,
        agentId: run.agentId,
        eventType: "tool_call.completed",
        payload: { tool: "tests", status: "ok" },
        confidence: 0.95
      })
    );

    core.addEvent(
      makeEvent({
        eventId: "evt_conclusion_1",
        runId: run.runId,
        agentId: run.agentId,
        eventType: "reasoning.conclusion",
        payload: { text: "Deployment can proceed based on completed verification." },
        confidence: 0.89,
        evidenceRefs: [{ eventId: "evt_tool_1", source: { connectorId: "test" } }]
      })
    );

    core.updateRunStatus(run.runId, "completed");

    const result = core.deriveWorkflowCandidate(run.runId, {
      promoteIfEligible: true,
      actorId: "system:theia"
    });

    expect(result.gateFailures).toEqual([]);
    expect(result.candidate.status).toBe("promoted");
    expect(result.candidate.gateMetrics.confidenceScore).toBeGreaterThanOrEqual(0.78);
  });

  it("routes high-impact workflow candidates to pending review", () => {
    const core = buildCore();
    const run = core.createRun("Apply privileged configuration change with safeguards", "agt_beta");

    core.addEvent(
      makeEvent({
        eventId: "evt_tool_2",
        runId: run.runId,
        agentId: run.agentId,
        eventType: "tool_call.completed",
        payload: { tool: "config-linter", status: "ok" },
        confidence: 0.9
      })
    );

    core.addEvent(
      makeEvent({
        eventId: "evt_conclusion_2",
        runId: run.runId,
        agentId: run.agentId,
        eventType: "reasoning.conclusion",
        payload: { text: "Configuration update should proceed with approval checkpoint." },
        confidence: 0.86,
        evidenceRefs: [{ eventId: "evt_tool_2", source: { connectorId: "test" } }]
      })
    );

    core.addEvent(
      makeEvent({
        eventId: "evt_priv_1",
        runId: run.runId,
        agentId: run.agentId,
        eventType: "privileged_action.executed",
        payload: { action: "apply_config" },
        confidence: 0.88
      })
    );

    core.updateRunStatus(run.runId, "completed");

    const result = core.deriveWorkflowCandidate(run.runId, {
      promoteIfEligible: true,
      actorId: "operator@theia"
    });

    expect(result.gateFailures).toEqual([]);
    expect(result.candidate.status).toBe("pending_review");
    expect(result.candidate.impactLevel).toBe("critical");
  });
});
