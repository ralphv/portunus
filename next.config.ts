import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const isNotProduction = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
   logging: {
    browserToTerminal: isNotProduction ? true : false,
    incomingRequests: {
      ignore: [/\/api\/v1\/health/],
    },
  },
  output: "standalone",
  // A Worker's CSP comes from its own script response, not the page, and the
  // middleware (which sets the page CSP) skips /_next/static. Give the vault
  // Worker (src/workers/vault.worker.ts) its own policy: same-origin script +
  // WebAssembly (Argon2id/libsodium), /api/vault and the Pwned Passwords API.
  // Browsers ignore CSP on non-worker script responses.
  async headers() {
    if (isNotProduction) return [];
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'none'",
              "script-src 'self' 'wasm-unsafe-eval'",
              "connect-src 'self' https://api.pwnedpasswords.com",
            ].join("; "),
          },
        ],
      },
    ];
  },
  // scripts/script-integrity.mjs pins one id across its two builds so the
  // prerendered inline scripts (which embed it) hash the same; unset → random.
  generateBuildId: async () => process.env.PORTUNUS_BUILD_ID || null,
  cacheComponents: true,
  partialPrefetching: true,
  // Code lives on a Windows-mounted drive (/mnt/d) under WSL — native file
  // events don't cross the boundary, so dev mode needs polling.
  watchOptions: { pollIntervalMs: 1000 },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// The strict CSP needs src/generated/script-integrity.ts from
// scripts/script-integrity.mjs; refuse a plain `next build` that would ship
// without its inline-script hashes.
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.PORTUNUS_SCRIPT_INTEGRITY_BUILD) {
    throw new Error("Build with `npm run build` (scripts/script-integrity.mjs), not plain `next build`.");
  }
  return nextConfig;
}
