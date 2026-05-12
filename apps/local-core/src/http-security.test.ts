import { describe, expect, it } from "vitest";
import { createCorsPolicy, evaluateCorsOrigin } from "./http-security.js";

describe("local-core CORS policy", () => {
  it("allows configured local dashboard origins", () => {
    const policy = createCorsPolicy({ allowedOrigins: "http://localhost:5174" });

    expect(evaluateCorsOrigin("http://localhost:5174", policy)).toEqual({
      allowed: true,
      origin: "http://localhost:5174"
    });
  });

  it("rejects untrusted browser origins instead of reflecting them", () => {
    const policy = createCorsPolicy({ allowedOrigins: "http://localhost:5173" });

    const decision = evaluateCorsOrigin("https://evil.example", policy);

    expect(decision.allowed).toBe(false);
    expect(decision.origin).toBeUndefined();
    expect(decision.reason).toContain("THEIA_ALLOWED_ORIGINS");
  });

  it("does not treat wildcard configuration as a safe allowed origin", () => {
    const policy = createCorsPolicy({ allowedOrigins: "*" });

    expect(evaluateCorsOrigin("https://evil.example", policy).allowed).toBe(false);
  });

  it("allows non-browser clients that send no Origin header", () => {
    const policy = createCorsPolicy();

    expect(evaluateCorsOrigin(undefined, policy)).toEqual({ allowed: true });
  });
});
