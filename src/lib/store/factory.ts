import type { NextRequest } from "next/server";

import { auth, getAccessToken } from "@/auth";
import { isDemoMode } from "@/lib/demo-mode";

import { GoogleDriveStoreProvider } from "./google-drive-store-provider";
import { MemoryStoreProvider } from "./memory-store-provider";
import type { StoreInterface } from "./store-interface";

// Picks the vault store for a request: in-memory in demo mode (no session or
// token needed), otherwise Google Drive with the caller's OAuth access token.
export async function getStore(
  req: NextRequest,
): Promise<{ store: StoreInterface } | { error: string }> {
  if (isDemoMode()) return { store: new MemoryStoreProvider() };

  const session = await auth();
  if (!session) return { error: "unauthorized" };
  if (session.error) return { error: session.error };
  const access = await getAccessToken(req);
  if ("error" in access) return { error: access.error };
  return { store: new GoogleDriveStoreProvider(access.accessToken) };
}
