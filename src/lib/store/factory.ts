import type { NextRequest } from "next/server";

import { DEMO_VISITOR_COOKIE, isDemoMode } from "@/lib/demo-mode";

import { GoogleDriveStoreProvider } from "./providers/google-drive-store-provider";
import { MemoryStoreProvider } from "./providers/memory-store-provider";
import type { StoreInterface } from "./store-interface";

function buildStore(accessToken: string): StoreInterface {
  return isDemoMode()
    ? new MemoryStoreProvider()
    : new GoogleDriveStoreProvider(accessToken);
}

// Kept on globalThis so the registry survives Next dev hot-reload; the
// module-level Map would be replaced with a fresh one and drop active vaults.
const globalRegistry = globalThis as typeof globalThis & {
  __portunusStoreInstances?: Map<string, StoreInterface>;
};
const instances = (globalRegistry.__portunusStoreInstances ??= new Map());

// Bounded LRU: without eviction every refreshed OAuth token and every new
// demo visitor would be retained for the process lifetime. Accesses re-seal
// entries; inserts past the cap evict the least-recently-used.
const MAX_INSTANCES = 500;

// In demo mode the key is the visitor cookie, not a token — each browser gets
// its own isolated in-memory vault.
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
    if (instances.size >= MAX_INSTANCES) {
      instances.delete(instances.keys().next().value!);
    }
    store = buildStore(accessToken);
  } else {
    // Re-insert to refresh LRU position.
    instances.delete(key);
  }
  instances.set(key, store);
  return store;
}

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
