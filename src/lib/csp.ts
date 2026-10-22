// Strict Content-Security-Policy — the primary, browser-enforced control
// against injected scripts. The runtime self-check
// (src/components/script-integrity-check.tsx) is only secondary
// tamper-evidence on top of it.
//
// script-src allows same-origin chunks ('self'), this request's nonce (scripts
// Next.js streams during a dynamic render), and the SHA-256 of every inline
// script in the build's prerendered HTML (the static shell — theme and
// recorder init scripts, Next/React bootstrap — is built once, without a
// nonce). Hashes come from src/generated/script-integrity.ts.

export interface CspOptionsInterface {
  nonce: string;
  inlineScriptHashes: readonly string[];
  /** false when the build didn't run scripts/script-integrity.mjs. */
  generated: boolean;
  dev: boolean;
}

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Whether the policy carries a nonce (and so must be forwarded to Next). */
export function cspUsesNonce(opts: Pick<CspOptionsInterface, "dev" | "generated">): boolean {
  return !opts.dev && opts.generated;
}

export function contentSecurityPolicy(opts: CspOptionsInterface): string {
  // hash-wasm (Argon2id) and libsodium compile WebAssembly.
  const script = ["'self'", "'wasm-unsafe-eval'"];
  if (cspUsesNonce(opts)) {
    script.push(
      `'nonce-${opts.nonce}'`,
      ...opts.inlineScriptHashes.map((h) => `'sha256-${h}'`),
    );
  } else {
    // Dev (HMR, React debug eval) or an ungenerated build: no hash list to
    // pin inline scripts to, so fall back rather than break the app.
    script.push("'unsafe-inline'");
    if (opts.dev) script.push("'unsafe-eval'");
  }
  return [
    `script-src ${script.join(" ")}`,
    // qr-scanner decodes in a Worker created from a blob: URL.
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
