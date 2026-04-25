import { describe, expect, it } from "vitest";
import { workflowEventSchema } from "./schema.js";

describe("workflowEventSchema", () => {
  it("accepts a valid workflow event", () => {
    const parsed = workflowEventSchema.parse({
      eventId: "evt_1",
      workspaceId: "ws_1",
      agentId: "agt_1",
      runId: "run_1",
      eventType: "run.started",
      timestamp: "2026-01-01T00:00:00Z",
      payload: { objective: "test" },
      source: { connectorId: "local" },
      evidenceRefs: []
    });

    expect(parsed.eventId).toBe("evt_1");
  });
});