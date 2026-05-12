import { describe, expect, it } from "vitest";
import {
  buildConnectorDiscoveryCandidates,
  redactConnectorRegistration,
  validateConnectorEndpoint,
  type ConnectorRegistrationRecord
} from "./connector-setup.js";

describe("connector setup helpers", () => {
  it("builds Octopoda, OpenClaw, and MCP discovery cards with setup commands", () => {
    const candidates = buildConnectorDiscoveryCandidates({
      repoRoot: "C:\\repo\\theia",
      localCoreBaseUrl: "http://localhost:4318",
      openClawPath: "C:\\Users\\admin_1\\src\\openclaw",
      openClawExists: true,
      octopodaLocalReachable: false,
      hasOctopodaCloudKey: false
    });

    expect(candidates.map((candidate) => candidate.connectorId)).toEqual([
      "octopoda-local",
      "octopoda-cloud",
      "openclaw-skill",
      "theia-mcp"
    ]);
    expect(candidates[0]?.commands?.install?.join("\n")).toContain("octopoda[server,mcp]");
    expect(JSON.stringify(candidates[3]?.commands?.mcpConfig)).toContain("theia-mcp-server.mjs");
  });

  it("rejects unsafe connector endpoints and allows loopback/local or allowlisted cloud", () => {
    expect(validateConnectorEndpoint({ endpoint: "http://localhost:7842", mode: "local" })).toMatchObject({ ok: true });
    expect(validateConnectorEndpoint({ endpoint: "http://evil.example", mode: "local" })).toMatchObject({
      ok: false,
      message: "Local connectors must use localhost/127.0.0.1 unless explicitly allowlisted."
    });
    expect(validateConnectorEndpoint({ endpoint: "http://api.octopodas.com", mode: "cloud" })).toMatchObject({
      ok: false,
      message: "Cloud connector endpoints must use https."
    });
    expect(validateConnectorEndpoint({ endpoint: "https://api.octopodas.com", mode: "cloud" })).toMatchObject({ ok: true });
  });

  it("redacts connector endpoints while keeping hasSecret only as a boolean", () => {
    const record: ConnectorRegistrationRecord = {
      connectorId: "octopoda-cloud",
      kind: "octopoda",
      displayName: "Octopoda Cloud",
      lane: "pull",
      mode: "cloud",
      endpoint: "https://api.octopodas.com",
      endpointLabel: "https://api.octopodas.com",
      authKind: "api_key",
      hasSecret: true,
      capabilities: ["read_agent_registry"],
      status: "healthy",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z"
    };
    expect(redactConnectorRegistration(record)).not.toHaveProperty("endpoint");
    expect(redactConnectorRegistration(record).hasSecret).toBe(true);
  });
});
