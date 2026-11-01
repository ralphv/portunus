import type { NextRequest } from "next/server";

import { createStoreFactory } from "@/factory";
import { DEMO_VISITOR_COOKIE, isDemoMode } from "@/lib/demo-mode";

import type { StoreInterface } from "./store-interface";

// The visitor cookie is set by middleware on every demo-mode response, so it
// outlives sign-out/sign-in and needs no authjs secret to read. Requests
// without it (middleware can't tag the very first call) share an "anonymous"
// bucket that can never reach a tagged visitor's vault.
function demoVisitorId(req: NextRequest): string {
  const cookie = req.headers.get("cookie") ?? "";
  const id = new RegExp(`(?:^|;\\s*)${DEMO_VISITOR_COOKIE}=([^;]+)`).exec(
    cookie,
  )?.[1];
  return id && /^[\w-]+$/.test(id) ? id : "anonymous";
}

// Picks the vault store for a request: in-memory in demo mode (no session or
// token needed), otherwise Google Drive with the caller's OAuth access token.
export async function getStore(
  req: NextRequest,
): Promise<{ store: StoreInterface } | { error: string }> {
  if (isDemoMode()) {
    return { store: createStoreFactory(demoVisitorId(req)) };
  }

  // Imported lazily so creating a store (e.g. the boot-time requirements
  // check) doesn't pull in next-auth.
  const { auth, getAccessToken } = await import("@/auth");
  const session = await auth();
  if (!session) return { error: "unauthorized" };
  if (session.error) return { error: session.error };
  const access = await getAccessToken(req);
  if ("error" in access) return { error: access.error };
  return { store: createStoreFactory(access.accessToken) };
}
