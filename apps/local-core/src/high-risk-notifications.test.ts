import { describe, expect, it } from "vitest";
import type { WorkflowEvent } from "@theia/event-schema";
import { HighRiskNotificationEngine } from "./high-risk-notifications.js";

function makeEvent(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
  return {
    eventId: "evt_1",
    workspaceId: "ws_local_default",
    runId: "run_1",
    agentId: "agent_1",
    eventType: "privileged_action.executed",
    timestamp: new Date("2026-01-01T12:00:00.000Z").toISOString(),
    payload: {
      command: "sudo rm -rf /tmp/demo"
    },
    source: {
      connectorId: "openclaw-main"
    },
    confidence: 0.91,
    evidenceRefs: [],
    ...overrides
  };
}

describe("HighRiskNotificationEngine", () => {
  it("detects privileged destructive events and emits dispatched notifications", () => {
    const engine = new HighRiskNotificationEngine();
    const summary = engine.ingestEvents([makeEvent()]);
    const history = engine.listHistory({ limit: 5 });

    expect(summary.detected).toBeGreaterThan(0);
    expect(summary.dispatched).toBeGreaterThan(0);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]?.dedupeStatus).toBe("dispatched");
    expect(history[0]?.channels.some((channel) => channel.channel === "in_app_banner")).toBe(true);
    expect(engine.getActiveBanner()?.notificationId).toBe(history[0]?.notificationId);
  });

  it("does not keep high-risk banners alive after the live window", () => {
    let now = new Date("2026-01-01T12:00:00.000Z");
    const engine = new HighRiskNotificationEngine(undefined, {
      now: () => now
    });

    engine.ingestEvents([makeEvent({ timestamp: now.toISOString() })]);
    expect(engine.getActiveBanner()).toBeDefined();

    now = new Date("2026-01-01T12:11:00.000Z");
    expect(engine.getActiveBanner()).toBeUndefined();
  });

  it("does not promote local file ingestion replay events to the live banner", () => {
    const engine = new HighRiskNotificationEngine();

    engine.ingestEvents([
      makeEvent({
        eventId: "local-file-main:error:1",
        runId: "run:file-ingestion",
        agentId: "agent:external",
        source: {
          connectorId: "local-file-main",
          filePath: "C:\\Users\\admin_1\\.openclaw\\workspace\\MEMORY.md"
        }
      })
    ]);

    const history = engine.listHistory({ limit: 5 });
    expect(history[0]?.dedupeStatus).toBe("dispatched");
    expect(engine.getActiveBanner()).toBeUndefined();
  });

  it("suppresses events when confidence threshold is too high", () => {
    const engine = new HighRiskNotificationEngine();
    engine.updateSettings({
      minimumConfidence: 0.99
    });
    const summary = engine.ingestEvents([makeEvent({ eventId: "evt_2", runId: "run_2", agentId: "agent_2" })]);
    const history = engine.listHistory({ limit: 5 });

    expect(summary.detected).toBeGreaterThan(0);
    expect(history[0]?.dedupeStatus).toBe("filtered_threshold");
    expect(history[0]?.status).toBe("resolved");
  });
});
