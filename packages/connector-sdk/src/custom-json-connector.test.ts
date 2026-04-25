import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CustomJsonConnector } from "./custom-json-connector.js";

describe("CustomJsonConnector", () => {
  it("reads event arrays from custom JSON files", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "theia-json-"));
    const jsonPath = path.join(tempRoot, "events.json");

    await writeFile(
      jsonPath,
      JSON.stringify({
        events: [
          {
            timestamp: "2026-01-01T00:00:00Z",
            eventType: "task.updated",
            runId: "run_custom",
            payload: { title: "step one" }
          }
        ]
      }),
      "utf8"
    );

    const connector = new CustomJsonConnector({
      connectorId: "json-test",
      jsonPaths: [jsonPath]
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

    expect(events.length).toBe(1);
    expect(events[0]?.eventType).toBe("task.updated");
    expect(events[0]?.runId).toBe("run_custom");
  });
});