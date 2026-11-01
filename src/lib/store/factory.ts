import { LRUCache } from "lru-cache";

import { isDemoMode } from "@/lib/demo-mode";

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
