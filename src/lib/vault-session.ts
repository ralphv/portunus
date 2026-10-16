import {
  defaultEngine,
  getEngine,
  headerOf,
  parseEnvelope,
  serializeEnvelope,
  VaultError,
} from "@/crypto";
import type { VaultEnvelope, VaultSecrets } from "@/crypto";

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
  etag: string;
  modifiedTime?: string;
  contents: string;
};

export async function fetchRemoteVault(): Promise<RemoteVault | null> {
  const res = await fetch("/api/vault");
  if (res.status === 404) return null;
  if (!res.ok) throw new VaultRemoteError(res.status, await res.text());
  return (await res.json()) as RemoteVault;
}

async function uploadVault(
  fileId: string | null,
  baseEtag: string | null,
  contents: string,
): Promise<{ fileId: string; etag: string; modifiedTime?: string }> {
  const res = await fetch("/api/vault", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, baseEtag, contents }),
  });
  if (!res.ok) throw new VaultRemoteError(res.status, await res.text());
  return (await res.json()) as {
    fileId: string;
    etag: string;
    modifiedTime?: string;
  };
}

export class VaultSession {
  dirty = false;

  private constructor(
    private fileId: string,
    private etag: string,
    private envelope: VaultEnvelope,
    private dataKey: Uint8Array,
    private plaintext: Uint8Array,
  ) {}

  // Returns null when the user has no vault yet — caller offers "create".
  static async unlock(secrets: VaultSecrets): Promise<VaultSession | null> {
    const remote = await fetchRemoteVault();
    if (!remote) return null;
    const envelope = parseEnvelope(remote.contents);
    const engine = getEngine(envelope.engine);
    const dataKey = await engine.unlock(envelope, secrets);
    const plaintext = await engine.decrypt(envelope, dataKey);
    return new VaultSession(
      remote.fileId,
      remote.etag,
      envelope,
      dataKey,
      plaintext,
    );
  }

  static async create(
    secrets: VaultSecrets,
    plaintext: Uint8Array,
  ): Promise<VaultSession> {
    const engine = defaultEngine();
    const init = await engine.initNew(secrets);
    const envelope = await engine.encrypt(init.header, init.dataKey, plaintext);
    const meta = await uploadVault(null, null, serializeEnvelope(envelope));
    return new VaultSession(meta.fileId, meta.etag, envelope, init.dataKey, plaintext);
  }

  get data(): Uint8Array {
    return this.plaintext;
  }

  update(plaintext: Uint8Array): void {
    this.plaintext = plaintext;
    this.dirty = true;
  }

  // Vault was written by an older engine — next save re-wraps under the
  // default engine with a fresh data key (free rotation).
  get needsEngineUpgrade(): boolean {
    return this.envelope.engine !== defaultEngine().id;
  }

  // Phase 4's save flow re-prompts the master password; this verifies it
  // against the vault header without touching the payload.
  async verifySecrets(secrets: VaultSecrets): Promise<void> {
    await getEngine(this.envelope.engine).unlock(
      headerOf(this.envelope),
      secrets,
    );
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
      this.etag,
      serializeEnvelope(envelope),
    );
    this.envelope = envelope;
    this.fileId = meta.fileId;
    this.etag = meta.etag;
    this.dataKey = dataKey;
    this.dirty = false;
  }

  lock(): void {
    this.dataKey.fill(0);
    this.plaintext.fill(0);
  }
}
