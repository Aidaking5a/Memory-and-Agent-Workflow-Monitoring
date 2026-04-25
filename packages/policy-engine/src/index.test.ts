import { describe, expect, it } from "vitest";
import { PolicyEngine } from "./index.js";

describe("PolicyEngine", () => {
  it("allows authorized action with matching grant", () => {
    const policy = new PolicyEngine();

    policy.registerGrant({
      grantId: "grant_1",
      workspaceId: "ws_1",
      subjectId: "user_1",
      scopeType: "connector",
      scopeValue: "local",
      grantMode: "persistent",
      grantedBy: "owner_1",
      grantedAt: "2026-01-01T00:00:00Z"
    });

    const decision = policy.evaluate({
      principal: { principalId: "user_1", role: "operator", workspaceId: "ws_1" },
      action: "connector.read",
      resourceType: "connector",
      resourceValue: "local",
      timestamp: "2026-01-01T00:10:00Z"
    });

    expect(decision.allowed).toBe(true);
  });
});