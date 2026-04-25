import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalFileConnector } from "./local-file-connector.js";

describe("LocalFileConnector", () => {
  it("emits memory.changed when content changes", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "theia-connector-"));
    const memoryPath = path.join(tempRoot, "memory.md");
    await writeFile(memoryPath, "# Memory\n- A", "utf8");

    const connector = new LocalFileConnector({
      connectorId: "local-test",
      files: [memoryPath]
    });

    await connector.init({
      scope: { workspaceId: "ws_1", approvedPaths: [tempRoot] },
      context: {
        workspaceId: "ws_1",
        now: () => new Date("2026-01-01T00:00:00Z"),
        emitEvent: () => undefined,
        emitAudit: () => undefined
      }
    });

    const events = await connector.poll();
    expect(events.length).toBe(1);
    expect(events[0]?.eventType).toBe("memory.changed");
  });
});