import {
  assertDeviceRecordCurrent,
  defaultEngine,
  DeviceUnlockError,
  getEngine,
  headerOf,
  keyfileFromKey,
  parseEnvelope,
  sameKey,
  serializeEnvelope,
  unwrapDeviceDataKey,
  VaultError,
  wrapDataKeyForDevice,
} from "@/crypto";
import type {
  DeviceUnlockMeta,
  DeviceUnlockRecord,
  Keyfile,
  VaultEnvelope,
  VaultSecrets,
} from "@/crypto";
import { DEVICE_UNLOCK_FAILED_MESSAGE } from "@/constants";

import {
  fetchRemoteVault,
  uploadVault,
} from "./vault-remote";
import type {
  CachedVault,
  RemoteVault,
  TotpChange,
  VaultCachePolicy,
} from "./vault-remote";

export { fetchRemoteVault, VaultRemoteError, writeVaultCache } from "./vault-remote";
export type { RemoteVault } from "./vault-remote";

// Vault store: fetch → decrypt → edit → encrypt → upload, with dirty
// tracking. Runs inside the vault Worker in the app (src/workers/). Only
// ciphertext ever crosses /api/vault.

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
  static async unlock(
    secrets: VaultSecrets,
    cachePolicy: VaultCachePolicy,
  ): Promise<VaultSession | null> {
    const remote = await fetchRemoteVault(cachePolicy);
    return remote ? VaultSession.fromRemote(remote, secrets) : null;
  }

  static async fromRemote(
    remote: RemoteVault,
    secrets: VaultSecrets,
  ): Promise<VaultSession> {
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

  // Fingerprint unlock: recovers the data key from this device's record with
  // the passkey's PRF output instead of running the password KDF. The
  // keyfile is still required — it must be the one the record was made for,
  // and later password checks / password changes need it.
  static async fromRemoteWithDevice(
    remote: RemoteVault,
    record: DeviceUnlockRecord,
    prf: Uint8Array,
    keyfile: Uint8Array,
  ): Promise<VaultSession> {
    const envelope = parseEnvelope(remote.contents);
    const { kid } = await keyfileFromKey(keyfile);
    if (record.kid !== kid) {
      throw new DeviceUnlockError(DEVICE_UNLOCK_FAILED_MESSAGE);
    }
    const dataKey = await unwrapDeviceDataKey(record, headerOf(envelope), prf);
    let plaintext: Uint8Array;
    try {
      plaintext = await getEngine(envelope.engine).decrypt(envelope, dataKey);
    } catch (e) {
      dataKey.fill(0);
      throw e;
    }
    const session = new VaultSession(
      remote.fileId,
      remote.modifiedTime,
      envelope,
      dataKey,
      plaintext,
      keyfile,
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

  // What the offline cache should hold after the last load/save.
  get cacheEntry(): CachedVault {
    return {
      fileId: this.fileId,
      modifiedTime: this.modifiedTime,
      contents: serializeEnvelope(this.envelope),
    };
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
    const dataKey = await getEngine(this.envelope.engine).unlock(
      headerOf(this.envelope),
      { password, keyfile: this.keyfile },
    );
    dataKey.fill(0); // a copy of the held key — only success matters here
  }

  // Encrypts a copy of the held data key for this device (fingerprint
  // enrollment). `meta.kid` must be the held keyfile's id.
  async wrapForDevice(
    prf: Uint8Array,
    meta: DeviceUnlockMeta,
    now?: Date,
  ): Promise<DeviceUnlockRecord> {
    const { kid } = await keyfileFromKey(this.keyfile);
    if (meta.kid !== kid) {
      throw new DeviceUnlockError(DEVICE_UNLOCK_FAILED_MESSAGE);
    }
    return wrapDataKeyForDevice({
      dataKey: this.dataKey,
      header: headerOf(this.envelope),
      prf,
      meta,
      now,
    });
  }

  // Fingerprint re-check (e.g. confirming a save): the record must belong
  // to the current header and yield the held data key.
  async verifyDevice(record: DeviceUnlockRecord, prf: Uint8Array): Promise<void> {
    const header = headerOf(this.envelope);
    await assertDeviceRecordCurrent(record, header);
    const dataKey = await unwrapDeviceDataKey(record, header, prf);
    try {
      if (!(await sameKey(dataKey, this.dataKey))) {
        throw new DeviceUnlockError(DEVICE_UNLOCK_FAILED_MESSAGE);
      }
    } finally {
      dataKey.fill(0);
    }
  }

  // Throws VaultRemoteError(409) when Drive reports a concurrent write —
  // dirty stays set so the caller can reload and retry. `totp` changes the
  // server-side two-factor block in the same write (see uploadVault).
  // `password` is needed only when an older engine wrote the vault: the
  // save then re-wraps it under the default engine with a fresh data key.
  async save(password?: string, totp?: TotpChange): Promise<void> {
    let header = headerOf(this.envelope);
    let dataKey = this.dataKey;
    if (this.needsEngineUpgrade) {
      if (!password) {
        throw new VaultError(
          "Master password required to upgrade the vault's encryption",
        );
      }
      // Re-wrapping under a mistyped password would lock the owner out —
      // it must unlock the current header first.
      await this.verifyPassword(password);
      const init = await defaultEngine().initNew({
        password,
        keyfile: this.keyfile,
      });
      header = init.header;
      dataKey = init.dataKey;
    }
    let envelope: VaultEnvelope;
    let meta: Awaited<ReturnType<typeof uploadVault>>;
    try {
      envelope = await getEngine(header.engine).encrypt(
        header,
        dataKey,
        this.plaintext,
      );
      meta = await uploadVault(
        this.fileId,
        this.modifiedTime ?? null,
        serializeEnvelope(envelope),
        totp,
      );
    } catch (e) {
      // The upgrade's new key never made it to Drive — drop it.
      if (dataKey !== this.dataKey) dataKey.fill(0);
      throw e;
    }
    this.envelope = envelope;
    this.fileId = meta.fileId;
    this.modifiedTime = meta.modifiedTime;
    if (dataKey !== this.dataKey) {
      this.dataKey.fill(0);
      this.dataKey = dataKey;
    }
    this.dirty = false;
  }

  // Called when connectivity returns after an offline unlock. If Drive's
  // copy still matches what this session holds, adopts the fresh remote
  // baseline and flips back to read-write (returns false). If the vault
  // changed while we were offline, returns true and STAYS offline —
  // stale plaintext must not become writable and clobber the newer copy.
  reconnect(remote: RemoteVault): boolean {
    if (remote.contents !== serializeEnvelope(this.envelope)) return true;
    this.fileId = remote.fileId;
    this.modifiedTime = remote.modifiedTime;
    this.offline = false;
    return false;
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
