import { afterEach, describe, expect, it, vi } from "vitest";

import { checkRequirements } from "./check-requirements";

const AUTH_VARS = ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "AUTH_SECRET", "AUTH_URL"];

afterEach(() => vi.unstubAllEnvs());

function clearAuthEnv() {
  for (const name of AUTH_VARS) vi.stubEnv(name, "");
}

describe("checkRequirements", () => {
  it("throws when auth env vars are missing", () => {
    clearAuthEnv();
    vi.stubEnv("PORTUNUS_DEMO_MODE", "");
    expect(() => checkRequirements()).toThrow(/AUTH_GOOGLE_ID/);
  });

  it("is skipped in demo mode", () => {
    clearAuthEnv();
    vi.stubEnv("PORTUNUS_DEMO_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect(() => checkRequirements()).not.toThrow();
  });

  it("still enforces requirements when demo mode is set in production", () => {
    clearAuthEnv();
    vi.stubEnv("PORTUNUS_DEMO_MODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => checkRequirements()).toThrow();
  });
});
