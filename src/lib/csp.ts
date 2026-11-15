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

import { GOOGLE_ACCOUNTS_ORIGIN } from "@/constants";

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
export function cspUsesNonce(opts: Pick<CspOptionsInterface, "dev">): boolean {
  return !opts.dev;
}

export function contentSecurityPolicy(opts: CspOptionsInterface): string {
  // hash-wasm (Argon2id) and libsodium compile WebAssembly.
  const script = ["'self'", "'wasm-unsafe-eval'"];
  if (cspUsesNonce(opts)) {
    // Fail closed: an ungenerated production build gets no hashes (its
    // prerendered inline scripts are blocked), never 'unsafe-inline'.
    script.push(
      `'nonce-${opts.nonce}'`,
      ...(opts.generated ? opts.inlineScriptHashes : []).map((h) => `'sha256-${h}'`),
    );
  } else {
    // Dev server only: HMR and React's debug tooling need inline + eval.
    script.push("'unsafe-inline'", "'unsafe-eval'");
  }
  return [
    // Anything not named below: same origin only.
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    // Stylesheets are same-origin files (Tailwind, next/font). Inline style
    // *attributes* (React `style={…}` in the server-rendered HTML) stay
    // allowed; inline <style> elements don't, except on the dev server,
    // whose CSS hot reload injects them.
    `style-src ${opts.dev ? "'self' 'unsafe-inline'" : "'self'"}`,
    "style-src-attr 'unsafe-inline'",
    // next/font serves the fonts from /_next/static/media.
    "font-src 'self'",
    // blob:: the QR scanner loads the picked image from an object URL;
    // data:: inline SVG/PNG data URLs.
    "img-src 'self' data: blob:",
    // The page only talks to its own API. The Pwned Passwords lookups run
    // in the vault Worker, under the Worker's own policy (next.config.ts).
    "connect-src 'self'",
    "manifest-src 'self'",
    // qr-scanner decodes in a Worker created from a blob: URL.
    "worker-src 'self' blob:",
    // Sign-in/out use fetch + a navigation (next-auth/react), not forms;
    // Google is allowed for Auth.js's own fallback sign-in page, whose form
    // posts here and is redirected on to Google (form-action covers
    // redirects).
    `form-action 'self' ${GOOGLE_ACCOUNTS_ORIGIN}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
