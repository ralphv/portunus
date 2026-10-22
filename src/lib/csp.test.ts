import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, cspUsesNonce, generateNonce } from "./csp";

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name, values];
    }),
  );

describe("contentSecurityPolicy", () => {
  it("production: self + nonce + build hashes, no unsafe-inline/eval", () => {
    const csp = contentSecurityPolicy({
      nonce: "abc",
      inlineScriptHashes: ["h1=", "h2="],
      generated: true,
      dev: false,
    });
    const d = directives(csp);
    expect(d["script-src"]).toEqual([
      "'self'",
      "'wasm-unsafe-eval'",
      "'nonce-abc'",
      "'sha256-h1='",
      "'sha256-h2='",
    ]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'none'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["worker-src"]).toEqual(["'self'", "blob:"]);
    expect(csp).not.toMatch(/unsafe-inline|'unsafe-eval'/);
  });

  it("dev or an ungenerated build falls back without a nonce", () => {
    const dev = contentSecurityPolicy({ nonce: "n", inlineScriptHashes: [], generated: false, dev: true });
    expect(directives(dev)["script-src"]).toEqual([
      "'self'",
      "'wasm-unsafe-eval'",
      "'unsafe-inline'",
      "'unsafe-eval'",
    ]);
    const stub = contentSecurityPolicy({ nonce: "n", inlineScriptHashes: [], generated: false, dev: false });
    expect(stub).not.toContain("nonce-");
    expect(stub).not.toContain("'unsafe-eval'");
    expect(cspUsesNonce({ dev: false, generated: false })).toBe(false);
    expect(cspUsesNonce({ dev: false, generated: true })).toBe(true);
  });

  it("generates fresh 128-bit base64 nonces", () => {
    const a = generateNonce();
    expect(atob(a)).toHaveLength(16);
    expect(generateNonce()).not.toBe(a);
  });
});
