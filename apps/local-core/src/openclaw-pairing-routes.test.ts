import { describe, expect, it } from "vitest";
import { buildOpenClawPairingCreatedResponse } from "./openclaw-pairing-routes.js";
import type { TelemetryPairingRecord } from "./openclaw-telemetry.js";

describe("OpenClaw pairing route payloads", () => {
  const pairing: TelemetryPairingRecord = {
    pairingId: "pair_test",
    label: "OpenClaw terminal",
    tokenHash: "hash",
    userId: "user_1",
    userEmail: "owner@theia.local",
    createdAt: "2026-05-12T10:00:00.000Z",
    expiresAt: "2026-05-13T10:00:00.000Z"
  };

  it("returns a one-time token with copyable telemetry commands", () => {
    const response = buildOpenClawPairingCreatedResponse({
      localCoreBaseUrl: "http://localhost:4318",
      pairing,
      token: "token_123",
      now: new Date("2026-05-12T10:05:00.000Z")
    });

    expect(response).toMatchObject({
      pairingId: "pair_test",
      label: "OpenClaw terminal",
      expiresAt: "2026-05-13T10:00:00.000Z",
      telemetryEndpoint: "http://localhost:4318/openclaw/telemetry/events",
      streamEndpoint: "http://localhost:4318/openclaw/telemetry/stream",
      token: "token_123"
    });
    expect(response.commands.powershell.join("\n")).toContain("THEIA_OPENCLAW_PAIRING_TOKEN");
    expect(response.commands.powershell.join("\n")).toContain("Authorization = \"Bearer $env:THEIA_OPENCLAW_PAIRING_TOKEN\"");
    expect(response.commands.bash.join("\n")).toContain("x-theia-pairing-id");
  });
});
