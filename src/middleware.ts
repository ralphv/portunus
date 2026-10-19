import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { DEMO_VISITOR_COOKIE, isDemoMode } from "@/lib/demo-mode";

// Request logging — the standalone server prints nothing per-request by
// default. Logs method + path + client IP (x-forwarded-for carries the real
// client through the reverse proxy).
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname + req.nextUrl.search;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "-";
  console.log(`[http] ${new Date().toISOString()} ${req.method} ${path} ip=${ip}`);
  const res = NextResponse.next();
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
