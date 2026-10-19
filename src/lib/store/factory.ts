import type { NextRequest } from "next/server";
import { LRUCache } from "lru-cache";

import { DEMO_VISITOR_COOKIE, isDemoMode } from "@/lib/demo-mode";

import { GoogleDriveStoreProvider } from "./providers/google-drive-store-provider";
import { MemoryStoreProvider } from "./providers/memory-store-provider";
import type { StoreInterface } from "./store-interface";

// Kept on globalThis so the registry survives Next dev hot-reload; the
// module-level cache would be replaced with a fresh one and drop active
// vaults. Bounded so demo visitors aren't retained for the process lifetime.
const globalRegistry = globalThis as typeof globalThis & {
  __portunusStoreInstances?: LRUCache<string, MemoryStoreProvider>;
};
const instances = (globalRegistry.__portunusStoreInstances ??= new LRUCache({
  max: 500,
}));

// Lifetime is decided by the provider. GoogleDriveStoreProvider is stateless
// (the access token is its only state), so each call gets a fresh instance —
// caching it would only retain expired tokens. MemoryStoreProvider holds the
// vault itself, so each visitor key maps to a cached instance or the vault
// would vanish between requests. Without request context (e.g. the boot-time
// requirements check) call with no arguments — demo mode needs no token.
export function createStoreFactory(accessToken = ""): StoreInterface {
  if (!isDemoMode()) {
    return new GoogleDriveStoreProvider(accessToken);
  }
  let store = instances.get(accessToken);
  if (!store) {
    store = new MemoryStoreProvider();
    instances.set(accessToken, store);
  }
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
