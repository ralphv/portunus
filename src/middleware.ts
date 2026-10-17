import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Request logging — the standalone server prints nothing per-request by
// default. Logs method + path + client IP (x-forwarded-for carries the real
// client through the reverse proxy).
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname + req.nextUrl.search;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "-";
  console.log(`[http] ${new Date().toISOString()} ${req.method} ${path} ip=${ip}`);
  return NextResponse.next();
}

// Skip static assets — they're noisy and uninteresting.
export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
