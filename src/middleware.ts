import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { scriptIntegrity } from "@/generated/script-integrity";
import { contentSecurityPolicy, cspUsesNonce, generateNonce } from "@/lib/csp";
import { DEMO_VISITOR_COOKIE, isDemoMode } from "@/lib/demo-mode";

const cspBase = {
  inlineScriptHashes: scriptIntegrity.inline,
  generated: scriptIntegrity.generated,
  dev: process.env.NODE_ENV === "development",
};

if (!cspBase.dev && !cspBase.generated) {
  console.warn(
    "[csp] src/generated/script-integrity.ts is a stub — build with `npm run build` " +
      "(not plain `next build`) for the strict nonce/hash CSP; falling back to 'unsafe-inline'.",
  );
}

// Request logging — the standalone server prints nothing per-request by
// default. Logs method + path + client IP (x-forwarded-for carries the real
// client through the reverse proxy).
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname + req.nextUrl.search;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "-";
  console.log(`[http] ${new Date().toISOString()} ${req.method} ${path} ip=${ip}`);
  // Strict CSP (src/lib/csp.ts). Next.js reads the nonce from the request's
  // CSP header and stamps it on the scripts it renders for this request.
  const csp = contentSecurityPolicy({ ...cspBase, nonce: generateNonce() });
  const requestHeaders = new Headers(req.headers);
  if (cspUsesNonce(cspBase)) requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  // Demo mode: tag each browser with a stable visitor id so its in-memory
  // vault survives sign-out/sign-in and stays isolated from other visitors.
  if (isDemoMode() && !req.cookies.has(DEMO_VISITOR_COOKIE)) {
    res.cookies.set(DEMO_VISITOR_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
    });
  }
  return res;
}

// Skip static assets — they're noisy and uninteresting.
export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
