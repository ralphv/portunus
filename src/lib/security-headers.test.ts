import { describe, expect, it } from "vitest";

import { securityHeaders } from "./security-headers";

const asMap = (h: [string, string][]) => Object.fromEntries(h);

describe("securityHeaders", () => {
  it("always sends nosniff, no-referrer and a restrictive Permissions-Policy", () => {
    const h = asMap(securityHeaders(undefined));
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("no-referrer");
    const pp = h["permissions-policy"];
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
    expect(pp).toContain("geolocation=()");
    expect(pp).toContain("clipboard-write=(self)");
    expect(pp).toContain("publickey-credentials-get=(self)");
    expect(pp).toContain("publickey-credentials-create=(self)");
  });

  it("adds HSTS only for an https:// AUTH_URL", () => {
    expect(asMap(securityHeaders("https://vault.example.com"))["strict-transport-security"]).toBe(
      "max-age=31536000",
    );
    expect(asMap(securityHeaders("http://localhost:3000"))).not.toHaveProperty(
      "strict-transport-security",
    );
    expect(asMap(securityHeaders(undefined))).not.toHaveProperty("strict-transport-security");
  });
});
