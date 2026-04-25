import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CodexCliConnector } from "./codex-cli-connector.js";

describe("CodexCliConnector", () => {
  it("parses JSONL codex logs into workflow events", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "theia-codex-"));
    const logPath = path.join(tempRoot, "codex.log");

    const logLines = [
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        eventType: "tool_call.completed",
        runId: "run_123",
        taskId: "task_1",
        payload: { tool: "shell", result: "ok" }
      }),
      "agent reached conclusion with assumption"
    ].join("\n");

    await writeFile(logPath, logLines, "utf8");

    const connector = new CodexCliConnector({
      connectorId: "codex-test",
      logPaths: [logPath]
    });

    await connector.init({
      scope: { workspaceId: "ws_1", approvedPaths: [tempRoot] },
      context: {
        workspaceId: "ws_1",
        now: () => new Date("2026-01-01T00:00:10Z"),
        emitEvent: () => undefined,
        emitAudit: () => undefined
      }
    });

    const events = await connector.poll();

    expect(events.length).toBe(2);
    expect(events[0]?.eventType).toBe("tool_call.completed");
    expect(events[1]?.eventType).toBe("reasoning.claim");
  });
});