import type { NextRequest } from "next/server";

import { isDemoMode } from "@/lib/demo-mode";

import { GoogleDriveStoreProvider } from "./google-drive-store-provider";
import { MemoryStoreProvider } from "./memory-store-provider";
import type { StoreInterface } from "./store-interface";

// Creates the vault store without request context (e.g. the boot-time
// requirements check). Demo mode needs no access token.
export function createStore(accessToken = ""): StoreInterface {
  return isDemoMode()
    ? new MemoryStoreProvider()
    : new GoogleDriveStoreProvider(accessToken);
}

// Picks the vault store for a request: in-memory in demo mode (no session or
// token needed), otherwise Google Drive with the caller's OAuth access token.
export async function getStore(
  req: NextRequest,
): Promise<{ store: StoreInterface } | { error: string }> {
  if (isDemoMode()) return { store: createStore() };

  // Imported lazily so creating a store (e.g. the boot-time requirements
  // check) doesn't pull in next-auth.
  const { auth, getAccessToken } = await import("@/auth");
  const session = await auth();
  if (!session) return { error: "unauthorized" };
  if (session.error) return { error: session.error };
  const access = await getAccessToken(req);
  if ("error" in access) return { error: access.error };
  return { store: createStore(access.accessToken) };
}
