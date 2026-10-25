import type { Keyfile, VaultSecrets } from "@/crypto";
import { VaultError } from "@/crypto/errors";

import type { PublicVaultData } from "./vault-public";
import { fetchRemoteVault, writeVaultCache } from "./vault-remote";
import { deserializeError } from "./vault-rpc";
import type {
  VaultRequest,
  VaultResponse,
  VaultWorkerApi,
  VaultWorkerMethod,
} from "./vault-rpc";

// Main-thread handle on one unlocked vault. The keys, the decrypted document
// and every secret live in a dedicated Worker; this side only sees the
// redacted PublicVaultData plus whatever it explicitly asks for. Imports no
// crypto code, so libsodium/hash-wasm load only inside the Worker.

export type VaultWorkerLike = {
  postMessage(message: VaultRequest): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<VaultResponse>) => void) | null;
  onerror: ((e: unknown) => void) | null;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

export function spawnVaultWorker(): VaultWorkerLike {
  return new Worker(new URL("../workers/vault.worker.ts", import.meta.url), {
    type: "module",
    name: "portunus-vault",
  }) as unknown as VaultWorkerLike;
}

export type UnlockedVault = { client: VaultClient; data: PublicVaultData };

export class VaultClient {
  // Unsaved edits exist (set by the UI on every draft change).
  dirty = false;
  // Unlocked from the offline ciphertext cache — read-only.
  offline = false;

  private nextId = 1;
  private pending = new Map<number, Pending>();
  private closed = false;

  constructor(private readonly worker: VaultWorkerLike) {
    worker.onmessage = (e) => {
      const res = e.data;
      const p = this.pending.get(res.id);
      if (!p) return;
      this.pending.delete(res.id);
      if (res.ok) p.resolve(res.result);
      else p.reject(deserializeError(res.error));
    };
    worker.onerror = () => {
      this.failPending(new VaultError("Vault worker failed"));
    };
  }

  // Returns null when the user has no vault yet — caller offers "create".
  static async unlock(
    secrets: VaultSecrets,
    spawn: () => VaultWorkerLike = spawnVaultWorker,
  ): Promise<UnlockedVault | null> {
    const remote = await fetchRemoteVault();
    if (!remote) return null;
    const client = new VaultClient(spawn());
    try {
      const opened = await client.call("open", remote, secrets);
      client.offline = opened.offline;
      return { client, data: opened.data };
    } catch (e) {
      client.lock();
      throw e;
    }
  }

  static async create(
    secrets: VaultSecrets,
    spawn: () => VaultWorkerLike = spawnVaultWorker,
  ): Promise<UnlockedVault> {
    const client = new VaultClient(spawn());
    try {
      const created = await client.call("create", secrets);
      writeVaultCache(created.cache);
      return { client, data: created.data };
    } catch (e) {
      client.lock();
      throw e;
    }
  }

  call<M extends VaultWorkerMethod>(
    method: M,
    ...args: Parameters<VaultWorkerApi[M]>
  ): Promise<Awaited<ReturnType<VaultWorkerApi[M]>>> {
    if (this.closed) return Promise.reject(new VaultError("Vault is locked"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage({ id, method, args });
    });
  }

  markDirty(): void {
    this.dirty = true;
  }

  // Back online after an offline unlock, with Drive's copy unchanged.
  markOnline(): void {
    this.offline = false;
  }

  // Throws VaultRemoteError(409) on a concurrent write; dirty stays set.
  async save(draft: PublicVaultData): Promise<PublicVaultData> {
    const saved = await this.call("save", draft);
    writeVaultCache(saved.cache);
    this.dirty = false;
    return saved.data;
  }

  async changePassword(
    newPassword: string,
    draft: PublicVaultData,
  ): Promise<PublicVaultData> {
    const saved = await this.call("changePassword", newPassword, draft);
    writeVaultCache(saved.cache);
    this.dirty = false;
    return saved.data;
  }

  exportKeyfile(): Promise<Keyfile> {
    return this.call("exportKeyfile");
  }

  // Terminating the Worker drops the keys and every decrypted secret.
  lock(): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    this.failPending(new VaultError("Vault is locked"));
  }

  private failPending(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
