import { describe, expect, it } from "vitest";
import { OpenClawTelemetryHub } from "./openclaw-telemetry.js";

describe("OpenClawTelemetryHub pairing authentication", () => {
  it("authenticates telemetry with a one-time-visible token and pairing id", () => {
    const hub = new OpenClawTelemetryHub({ workspaceId: "ws_test" });
    const created = hub.createPairing({
      label: "OpenClaw local terminal",
      userId: "user_1",
      userEmail: "owner@theia.local",
      ttlHours: 24
    });

    const pairing = hub.authenticatePairing({
      pairingId: created.pairing.pairingId,
      token: created.token
    });

    expect(pairing).toMatchObject({
      pairingId: created.pairing.pairingId,
      userId: "user_1",
      userEmail: "owner@theia.local"
    });
    expect(hub.listPairings()[0]?.lastUsedAt).toBeTruthy();
  });

  it("rejects wrong or revoked pairing tokens", () => {
    const hub = new OpenClawTelemetryHub({ workspaceId: "ws_test" });
    const created = hub.createPairing({
      label: "OpenClaw local terminal",
      userId: "user_1",
      userEmail: "owner@theia.local",
      ttlHours: 24
    });

    expect(hub.authenticatePairing({ pairingId: created.pairing.pairingId, token: "wrong" })).toBeUndefined();
    expect(hub.revokePairing(created.pairing.pairingId, "owner@theia.local")).toBe(true);
    expect(hub.authenticatePairing({ pairingId: created.pairing.pairingId, token: created.token })).toBeUndefined();
    expect(hub.listPairings()[0]?.active).toBe(false);
  });

  it("accepts a valid telemetry event only after pairing authentication succeeds", () => {
    const hub = new OpenClawTelemetryHub({ workspaceId: "ws_test" });
    const created = hub.createPairing({
      label: "OpenClaw local terminal",
      userId: "user_1",
      userEmail: "owner@theia.local",
      ttlHours: 24
    });
    const pairing = hub.authenticatePairing({
      pairingId: created.pairing.pairingId,
      token: created.token
    });

    expect(pairing).toBeTruthy();
    const result = hub.ingest({
      pairing: pairing!,
      requestRateKey: "test",
      body: {
        events: [
          {
            eventType: "agent.connected",
            status: "ok",
            message: "OpenClaw pairing smoke test.",
            timestamp: "2026-05-12T10:00:00.000Z",
            runId: "run:test",
            agentId: "agent:openclaw",
            source: "openclaw-hook"
          }
        ]
      },
      now: new Date("2026-05-12T10:00:01.000Z")
    });

    expect(result.ok).toBe(true);
    expect(result.acceptedCount).toBe(1);
    expect(hub.health().metrics.requestsAccepted).toBe(1);
  });
});
