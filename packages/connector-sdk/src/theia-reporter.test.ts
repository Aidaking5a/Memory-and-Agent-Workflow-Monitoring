import { describe, expect, it } from "vitest";
import { TheiaReporter } from "./theia-reporter.js";

describe("TheiaReporter", () => {
  it("builds strict agent telemetry and posts with bearer authentication", async () => {
    const calls: Array<{ url: string; init?: { headers?: Record<string, string>; body?: string } }> = [];
    const reporter = new TheiaReporter({
      endpoint: "http://localhost:4318/agent-network/telemetry/events",
      token: "theia_agent_test",
      workspaceId: "ws_1",
      agent: {
        agentId: "agent:test",
        name: "Test Agent",
        role: "Worker",
        domain: "testing",
        model: "qwen",
        vendor: "local",
        connectionKind: "mcp"
      },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 202,
          json: async () => ({ accepted: 1, rejected: 0, deduped: 0 }),
          text: async () => ""
        };
      }
    });

    const response = await reporter.reportActivity({
      category: "tool_execution",
      safeSummary: "Ran a safe test tool.",
      toolName: "unit_test",
      inputTokens: 10,
      outputTokens: 4
    });

    expect(response.accepted).toBe(1);
    expect(calls[0]?.init?.headers?.Authorization).toBe("Bearer theia_agent_test");
    expect(calls[0]?.init?.headers?.["x-theia-agent-id"]).toBe("agent:test");
    const payload = JSON.parse(calls[0]?.init?.body ?? "{}");
    expect(payload.schemaVersion).toBe("agent-activity/v1");
    expect(payload.usage.totalTokens).toBe(14);
    expect(JSON.stringify(payload)).not.toMatch(/chain[-_ ]?of[-_ ]?thought/i);
  });
});
