import { VAULT_CACHE_KEY } from "@/constants";
import { isOfflineCacheDisabled } from "./disable-offline-cache";

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

// The server's `{ error }` code from a failed /api/vault response, if any.
export function vaultRemoteErrorCode(e: unknown): string | null {
  if (!(e instanceof VaultRemoteError)) return null;
  try {
    const body = JSON.parse(e.message) as { error?: unknown };
    return typeof body.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

// 422 from GET /api/vault: the Drive file's server-side Ed25519 signature is
// missing or wrong. The vault must not be unlocked from it.
export function isVaultSignatureInvalid(e: unknown): boolean {
  return (
    e instanceof VaultRemoteError &&
    e.status === 422 &&
    vaultRemoteErrorCode(e) === "vault_signature_invalid"
  );
}

export const VAULT_SIGNATURE_INVALID_MESSAGE =
  "Vault signature invalid — the file may have been tampered with. Not unlocking.";

// Two-factor gate on /api/vault (the server checks TOTP codes against the
// block in its signed wrapper). 401 totp_required: no valid grant — send a
// code to /api/vault/unlock and retry. 401 totp_invalid: wrong or reused
// code. 429 totp_locked: too many wrong codes, wait a few minutes.
export function isTotpRequired(e: unknown): boolean {
  return (
    e instanceof VaultRemoteError &&
    e.status === 401 &&
    vaultRemoteErrorCode(e) === "totp_required"
  );
}

// User-facing message for a two-factor failure, or null for other errors.
export function totpErrorMessage(e: unknown): string | null {
  switch (vaultRemoteErrorCode(e)) {
    case "totp_required":
      return "Enter the 6-digit code from your authenticator app.";
    case "totp_invalid":
      return "That code didn't match. Wait for a fresh code and try again.";
    case "totp_locked":
      return "Too many wrong codes. Wait a few minutes and try again.";
    default:
      return null;
  }
}

// Exchanges a TOTP code for the server's short-lived grant cookie.
export async function unlockTotp(code: string): Promise<void> {
  const res = await fetch("/api/vault/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new VaultRemoteError(res.status, await res.text());
}

// Best-effort: drop the grant on lock so the next unlock asks again.
export async function clearTotpGrant(): Promise<void> {
  try {
    await fetch("/api/vault/unlock", { method: "DELETE" });
  } catch {
    // Offline — the grant expires on its own.
  }
}

// `{ secret, code }` enables (or replaces) the two-factor block; `null`
// removes it. Omitted on ordinary saves, which keep the stored block.
export type TotpChange = { secret: string; code: string } | null;

export type RemoteVault = {
  fileId: string;
  modifiedTime?: string;
  contents: string;
  offline?: boolean;
  // The stored wrapper carries a two-factor block.
  totpEnabled?: boolean;
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
  if (isOfflineCacheDisabled()) {
    clearVaultCache();
    return;
  }
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
  totp?: TotpChange,
): Promise<{ fileId: string; modifiedTime?: string; totpEnabled?: boolean }> {
  const res = await fetch("/api/vault", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileId,
      baseModifiedTime,
      contents,
      ...(totp !== undefined ? { totp } : {}),
    }),
  });
  if (!res.ok) throw new VaultRemoteError(res.status, await res.text());
  const meta = (await res.json()) as {
    fileId: string;
    modifiedTime?: string;
    totpEnabled?: boolean;
  };
  writeVaultCache({ fileId: meta.fileId, modifiedTime: meta.modifiedTime, contents });
  return meta;
}
