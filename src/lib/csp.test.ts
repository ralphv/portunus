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

  it("dev falls back to unsafe-inline; an ungenerated production build fails closed", () => {
    const dev = contentSecurityPolicy({ nonce: "n", inlineScriptHashes: [], generated: false, dev: true });
    expect(directives(dev)["script-src"]).toEqual([
      "'self'",
      "'wasm-unsafe-eval'",
      "'unsafe-inline'",
      "'unsafe-eval'",
    ]);
    const stub = contentSecurityPolicy({ nonce: "n", inlineScriptHashes: ["h="], generated: false, dev: false });
    expect(directives(stub)["script-src"]).toEqual(["'self'", "'wasm-unsafe-eval'", "'nonce-n'"]);
    expect(cspUsesNonce({ dev: false })).toBe(true);
    expect(cspUsesNonce({ dev: true })).toBe(false);
  });

  it("generates fresh 128-bit base64 nonces", () => {
    const a = generateNonce();
    expect(atob(a)).toHaveLength(16);
    expect(generateNonce()).not.toBe(a);
  });
});
