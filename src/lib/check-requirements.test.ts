import { afterEach, describe, expect, it, vi } from "vitest";

import { checkRequirements } from "./check-requirements";
import { testSigningKey } from "./signing.test-helper";

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

  it("skips requirements in demo mode under production builds too", () => {
    clearAuthEnv();
    vi.stubEnv("PORTUNUS_DEMO_MODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => checkRequirements()).not.toThrow();
  });

  it("throws when signatures are enabled and the signing key is missing", () => {
    for (const name of AUTH_VARS) vi.stubEnv(name, "set");
    vi.stubEnv("PORTUNUS_DEMO_MODE", "");
    vi.stubEnv("PORTUNUS_SIGNATURES_DISABLED", "");
    vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", "");
    expect(() => checkRequirements()).toThrow(/PORTUNUS_SIGNING_PRIVATE_KEY/);

    vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", testSigningKey());
    expect(() => checkRequirements()).not.toThrow();
  });

  it("needs no signing key with PORTUNUS_SIGNATURES_DISABLED=1", () => {
    for (const name of AUTH_VARS) vi.stubEnv(name, "set");
    vi.stubEnv("PORTUNUS_DEMO_MODE", "");
    vi.stubEnv("PORTUNUS_SIGNATURES_DISABLED", "1");
    vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", "");
    expect(() => checkRequirements()).not.toThrow();
  });
});
