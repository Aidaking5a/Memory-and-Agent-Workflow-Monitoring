import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OpenClawConnector } from "./openclaw-connector.js";

describe("OpenClawConnector", () => {
  it("maps OpenClaw JSONL traces into normalized tool events", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "theia-openclaw-"));
    const logPath = path.join(tempRoot, "openclaw.jsonl");
    const logLines = [
      JSON.stringify({
        created_at: "2026-04-26T12:00:00Z",
        run_id: "oc_run_7",
        agent_id: "oc_agent_a",
        step_id: "step_1",
        action_type: "tool_call",
        status: "completed",
        tool_name: "browser",
        confidence_score: 0.92
      })
    ].join("\n");

    await writeFile(logPath, logLines, "utf8");

    const connector = new OpenClawConnector({
      connectorId: "openclaw-test",
      logPaths: [logPath]
    });

    await connector.init({
      scope: { workspaceId: "ws_1", approvedPaths: [tempRoot] },
      context: {
        workspaceId: "ws_1",
        now: () => new Date("2026-04-26T12:00:10Z"),
        emitEvent: () => undefined,
        emitAudit: () => undefined
      }
    });

    const events = await connector.poll();

    expect(events.length).toBe(1);
    expect(events[0]?.eventType).toBe("tool_call.completed");
    expect(events[0]?.runId).toBe("oc_run_7");
    expect(events[0]?.agentId).toBe("oc_agent_a");
    expect(events[0]?.payload.sourceSystem).toBe("openclaw");
  });
});
