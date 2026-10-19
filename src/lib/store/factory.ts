import type { NextRequest } from "next/server";

import { DEMO_AUTH_SECRET, isDemoMode } from "@/lib/demo-mode";

import { GoogleDriveStoreProvider } from "./providers/google-drive-store-provider";
import { MemoryStoreProvider } from "./providers/memory-store-provider";
import type { StoreInterface } from "./store-interface";

function buildStore(accessToken: string): StoreInterface {
  return isDemoMode()
    ? new MemoryStoreProvider()
    : new GoogleDriveStoreProvider(accessToken);
}

// One instance per access token (Google Drive providers are bound to their
// token) and never shared across demo/non-demo.
const instances = new Map<string, StoreInterface>();

// In demo mode the key is the visitor's unique session id, not a token —
// each visitor gets their own isolated in-memory vault.
function cacheKey(accessToken: string): string {
  return isDemoMode() ? `demo:${accessToken}` : `drive:${accessToken}`;
}

// Creates the vault store, or returns the cached one. Pass `newInstance` to
// force a fresh provider. Without request context (e.g. the boot-time
// requirements check) call with no arguments — demo mode needs no token.
export function createStoreFactory(
  accessToken = "",
  newInstance = false,
): StoreInterface {
  if (newInstance) return buildStore(accessToken);
  const key = cacheKey(accessToken);
  let store = instances.get(key);
  if (!store) {
    store = buildStore(accessToken);
    instances.set(key, store);
  }
  return store;
}

// Each demo sign-in mints a unique JWT sub, so this keys the caller's vault
// to their browser session. No session → a shared "anonymous" bucket that
// can't reach any signed-in visitor's data.
async function demoVisitorId(req: NextRequest): Promise<string> {
  const { getToken } = await import("next-auth/jwt");
  const secureCookie = process.env.AUTH_URL?.startsWith("https://") ?? false;
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET ?? DEMO_AUTH_SECRET,
    secureCookie,
    salt: secureCookie
      ? "__Secure-authjs.session-token"
      : "authjs.session-token",
  });
  return typeof token?.sub === "string" ? token.sub : "anonymous";
}

// Picks the vault store for a request: in-memory in demo mode (no session or
// token needed), otherwise Google Drive with the caller's OAuth access token.
export async function getStore(
  req: NextRequest,
): Promise<{ store: StoreInterface } | { error: string }> {
  if (isDemoMode()) {
    const visitor = await demoVisitorId(req);
    return { store: createStoreFactory(visitor) };
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
