import { VAULT_CACHE_KEY } from "@/constants";

// Vault I/O against /api/vault plus the offline ciphertext cache. No crypto
// imports: the main thread uses this to fetch the envelope it hands to the
// vault Worker, and to mirror what the Worker uploaded into localStorage
// (Workers have no localStorage). Only ciphertext ever crosses /api/vault.

export class VaultRemoteError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "VaultRemoteError";
  }
}

export type RemoteVault = {
  fileId: string;
  modifiedTime?: string;
  contents: string;
  offline?: boolean;
};

// Offline mode: the last-synced envelope is mirrored in localStorage. It's
// ciphertext — the same exposure as the Drive copy — so this leaks nothing
// Drive doesn't already hold.
export type CachedVault = {
  fileId: string;
  modifiedTime?: string;
  contents: string;
};

function readVaultCache(): CachedVault | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const text = localStorage.getItem(VAULT_CACHE_KEY);
    return text ? (JSON.parse(text) as CachedVault) : null;
  } catch {
    return null;
  }
}

export function writeVaultCache(v: CachedVault): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(VAULT_CACHE_KEY, JSON.stringify(v));
  } catch {
    // Quota errors are non-fatal — offline cache is best-effort.
  }
}

function clearVaultCache(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(VAULT_CACHE_KEY);
}

export async function fetchRemoteVault(): Promise<RemoteVault | null> {
  try {
    const res = await fetch("/api/vault");
    if (res.status === 404) {
      // Server confirms no vault — the cache is stale by definition.
      clearVaultCache();
      return null;
    }
    if (!res.ok) throw new VaultRemoteError(res.status, await res.text());
    const remote = (await res.json()) as RemoteVault;
    writeVaultCache(remote);
    return remote;
  } catch (e) {
    // fetch throws TypeError on network failure only — server *responses*
    // (401/502/…) still propagate so real errors aren't masked as offline.
    if (e instanceof TypeError) {
      const cached = readVaultCache();
      if (cached) return { ...cached, offline: true };
    }
    throw e;
  }
}

export async function uploadVault(
  fileId: string | null,
  baseModifiedTime: string | null,
  contents: string,
): Promise<{ fileId: string; modifiedTime?: string }> {
  const res = await fetch("/api/vault", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, baseModifiedTime, contents }),
  });
  if (!res.ok) throw new VaultRemoteError(res.status, await res.text());
  const meta = (await res.json()) as {
    fileId: string;
    modifiedTime?: string;
  };
  writeVaultCache({ ...meta, contents });
  return meta;
}
