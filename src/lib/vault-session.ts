import { VAULT_CACHE_KEY } from "@/constants";
import {
  defaultEngine,
  getEngine,
  headerOf,
  keyfileFromKey,
  parseEnvelope,
  serializeEnvelope,
  VaultError,
} from "@/crypto";
import type { Keyfile, VaultEnvelope, VaultSecrets } from "@/crypto";

// Client-side vault store: fetch → decrypt → edit → encrypt → upload, with
// dirty tracking. Only ciphertext ever crosses /api/vault.

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
type CachedVault = {
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

function writeVaultCache(v: CachedVault): void {
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

async function uploadVault(
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

export class VaultSession {
  dirty = false;
  // True when unlocked from the offline ciphertext cache — read-only.
  offline = false;

  private plaintext: Uint8Array;
  private keyfile: Uint8Array;

  private constructor(
    private fileId: string,
    private modifiedTime: string | undefined,
    private envelope: VaultEnvelope,
    private dataKey: Uint8Array,
    plaintext: Uint8Array,
    keyfile: Uint8Array,
  ) {
    // Copy caller buffers — lock() zeroes these, and we must not wipe
    // arrays the caller still owns.
    this.plaintext = plaintext.slice();
    this.keyfile = keyfile.slice();
  }

  // Returns null when the user has no vault yet — caller offers "create".
  static async unlock(secrets: VaultSecrets): Promise<VaultSession | null> {
    const remote = await fetchRemoteVault();
    if (!remote) return null;
    const envelope = parseEnvelope(remote.contents);
    const engine = getEngine(envelope.engine);
    const dataKey = await engine.unlock(envelope, secrets);
    const plaintext = await engine.decrypt(envelope, dataKey);
    const session = new VaultSession(
      remote.fileId,
      remote.modifiedTime,
      envelope,
      dataKey,
      plaintext,
      secrets.keyfile,
    );
    session.offline = remote.offline ?? false;
    return session;
  }

  static async create(
    secrets: VaultSecrets,
    plaintext: Uint8Array,
  ): Promise<VaultSession> {
    const engine = defaultEngine();
    const init = await engine.initNew(secrets);
    const envelope = await engine.encrypt(init.header, init.dataKey, plaintext);
    const meta = await uploadVault(null, null, serializeEnvelope(envelope));
    return new VaultSession(
      meta.fileId,
      meta.modifiedTime,
      envelope,
      init.dataKey,
      plaintext,
      secrets.keyfile,
    );
  }

  get data(): Uint8Array {
    return this.plaintext;
  }

  update(plaintext: Uint8Array): void {
    this.plaintext.fill(0);
    this.plaintext = plaintext.slice();
    this.dirty = true;
  }

  // Vault was written by an older engine — next save re-wraps under the
  // default engine with a fresh data key (free rotation).
  get needsEngineUpgrade(): boolean {
    return this.envelope.engine !== defaultEngine().id;
  }

  // Save flow re-prompts the master password; this verifies it against the
  // vault header without touching the payload. The keyfile is held in memory.
  async verifyPassword(password: string): Promise<void> {
    await getEngine(this.envelope.engine).unlock(headerOf(this.envelope), {
      password,
      keyfile: this.keyfile,
    });
  }

  // Throws VaultRemoteError(409) when Drive reports a concurrent write —
  // dirty stays set so the caller can reload and retry.
  async save(secrets?: VaultSecrets): Promise<void> {
    let header = headerOf(this.envelope);
    let dataKey = this.dataKey;
    if (this.needsEngineUpgrade) {
      if (!secrets) {
        throw new VaultError("Secrets required for engine upgrade");
      }
      const init = await defaultEngine().initNew(secrets);
      header = init.header;
      dataKey = init.dataKey;
    }
    const envelope = await getEngine(header.engine).encrypt(
      header,
      dataKey,
      this.plaintext,
    );
    const meta = await uploadVault(
      this.fileId,
      this.modifiedTime ?? null,
      serializeEnvelope(envelope),
    );
    this.envelope = envelope;
    this.fileId = meta.fileId;
    this.modifiedTime = meta.modifiedTime;
    this.dataKey = dataKey;
    this.dirty = false;
  }

  // Re-encrypt + re-upload under a new master password: fresh data key
  // wrapped by Argon2id(newPassword ‖ keyfile). The keyfile itself is
  // unchanged — installed copies stay valid. Clears dirty: any pending
  // edits are flushed under the new password.
  async changePassword(newPassword: string): Promise<void> {
    const engine = defaultEngine();
    const init = await engine.initNew({
      password: newPassword,
      keyfile: this.keyfile,
    });
    const envelope = await engine.encrypt(
      init.header,
      init.dataKey,
      this.plaintext,
    );
    const meta = await uploadVault(
      this.fileId,
      this.modifiedTime ?? null,
      serializeEnvelope(envelope),
    );
    this.envelope = envelope;
    this.fileId = meta.fileId;
    this.modifiedTime = meta.modifiedTime;
    this.dataKey.fill(0);
    this.dataKey = init.dataKey;
    this.dirty = false;
  }

  // Re-export the held keyfile — the kid is recomputed from the key bytes.
  async exportKeyfile(): Promise<Keyfile> {
    return keyfileFromKey(this.keyfile);
  }

  lock(): void {
    this.dataKey.fill(0);
    this.plaintext.fill(0);
    this.keyfile.fill(0);
  }
}
