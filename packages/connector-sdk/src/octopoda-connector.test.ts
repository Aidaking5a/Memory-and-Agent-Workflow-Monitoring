import { describe, expect, it } from "vitest";
import { mapOctopodaAgentToActivityEvent } from "./octopoda-mapper.js";
import { OctopodaConnector } from "./octopoda-connector.js";

describe("Octopoda connector mapping", () => {
  it("maps Octopoda agent rows into agent-activity events without chain-of-thought", () => {
    const event = mapOctopodaAgentToActivityEvent({
      row: {
        agent_id: "researcher",
        agent_type: "research",
        state: "running",
        total_operations: 42,
        total_writes: 7,
        memory_node_count: 19,
        uptime_seconds: 12
      },
      workspaceId: "ws_1",
      connectorId: "octopoda-local",
      endpointLabel: "http://localhost:7842",
      now: new Date("2026-05-12T12:00:00.000Z")
    });

    expect(event.schemaVersion).toBe("agent-activity/v1");
    expect(event.agent.connectionKind).toBe("octopoda");
    expect(event.classification.category).toBe("memory_update");
    expect(event.what.safeSummary).toContain("42 Octopoda operation");
    expect(event.what).not.toHaveProperty("chainOfThought");
  });

  it("reports healthy, degraded, and unauthorized connector health states", async () => {
    const healthy = new OctopodaConnector({
      connectorId: "octopoda-local",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => [{ agent_id: "a1", state: "running" }],
        text: async () => ""
      })
    });
    await healthy.init({
      scope: { workspaceId: "ws_1", approvedPaths: [] },
      context: { workspaceId: "ws_1", now: () => new Date("2026-05-12T12:00:00.000Z"), emitEvent: () => undefined, emitAudit: () => undefined }
    });
    expect(await healthy.poll()).toHaveLength(1);
    expect((await healthy.health()).status).toBe("healthy");

    const degraded = new OctopodaConnector({
      connectorId: "octopoda-empty",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => [],
        text: async () => ""
      })
    });
    await degraded.init({
      scope: { workspaceId: "ws_1", approvedPaths: [] },
      context: { workspaceId: "ws_1", now: () => new Date("2026-05-12T12:00:00.000Z"), emitEvent: () => undefined, emitAudit: () => undefined }
    });
    await degraded.poll();
    expect((await degraded.health()).status).toBe("degraded");

    const unauthorized = new OctopodaConnector({
      connectorId: "octopoda-cloud",
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({}),
        text: async () => "unauthorized"
      })
    });
    await unauthorized.init({
      scope: { workspaceId: "ws_1", approvedPaths: [] },
      context: { workspaceId: "ws_1", now: () => new Date("2026-05-12T12:00:00.000Z"), emitEvent: () => undefined, emitAudit: () => undefined }
    });
    await unauthorized.poll();
    expect(await unauthorized.health()).toMatchObject({ status: "degraded", errorCode: "unauthorized" });
  });
});
