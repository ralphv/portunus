import { NextRequest } from "next/server";

import { handlers } from "@/auth";
import { isDemoMode } from "@/lib/demo-mode";

// The standalone server builds req.nextUrl.origin from its own HOSTNAME (the
// container id under Docker), and Auth.js only rewrites it when AUTH_URL is
// set — which demo mode doesn't require. Anchor the request to the real Host
// header instead so sign-in redirects and generated auth URLs stay reachable
// on whatever port the operator published.
function withHostOrigin(req: NextRequest): NextRequest {
  const host = req.headers.get("host");
  if (!host || !/^[\w.-]+(:\d+)?$/.test(host)) return req;
  const { origin } = req.nextUrl;
  const proto = req.headers.get("x-forwarded-proto") === "https" ? "https" : "http";
  const hostOrigin = `${proto}://${host}`;
  if (origin === hostOrigin) return req;
  return new NextRequest(req.nextUrl.href.replace(origin, hostOrigin), req);
}

function wrap(handler: (req: NextRequest) => Response | Promise<Response>) {
  return (req: NextRequest) =>
    handler(isDemoMode() ? withHostOrigin(req) : req);
}

export const GET = wrap(handlers.GET);
export const POST = wrap(handlers.POST);
