import {
  assertDeviceRecordCurrent,
  defaultEngine,
  DeviceUnlockError,
  getEngine,
  headerOf,
  kdfNeedsUpgrade,
  keyfileFromKey,
  parseEnvelope,
  PasswordRequiredError,
  sameKey,
  serializeEnvelope,
  unwrapDeviceDataKey,
  wrapDataKeyForDevice,
} from "@/crypto";
import type {
  DeviceUnlockMeta,
  DeviceUnlockRecord,
  KdfTarget,
  Keyfile,
  VaultEnvelope,
  VaultSecrets,
} from "@/crypto";
import {
  DEVICE_UNLOCK_FAILED_MESSAGE,
  ENGINE_UPGRADE_PASSWORD_REQUIRED_MESSAGE,
} from "@/constants";

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

  // Target Argon2id cost for wraps this session writes (new vaults, password
  // changes, and opportunistic cost upgrades). From PORTUNUS_KDF_*; undefined
  // falls back to the engine's own default cost.
  private targetKdf?: KdfTarget;

  private constructor(
    private fileId: string,
    private modifiedTime: string | undefined,
    private envelope: VaultEnvelope,
    private dataKey: Uint8Array,
    plaintext: Uint8Array,
    keyfile: Uint8Array,
    targetKdf?: KdfTarget,
  ) {
    // Copy caller buffers — lock() zeroes these, and we must not wipe
    // arrays the caller still owns.
    this.plaintext = plaintext.slice();
    this.keyfile = keyfile.slice();
    this.targetKdf = targetKdf;
  }

  // Returns null when the user has no vault yet — caller offers "create".
  static async unlock(
    secrets: VaultSecrets,
    cachePolicy: VaultCachePolicy,
    targetKdf?: KdfTarget,
  ): Promise<VaultSession | null> {
    const remote = await fetchRemoteVault(cachePolicy);
    return remote ? VaultSession.fromRemote(remote, secrets, targetKdf) : null;
  }

  static async fromRemote(
    remote: RemoteVault,
    secrets: VaultSecrets,
    targetKdf?: KdfTarget,
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
      targetKdf,
    );
    session.offline = remote.offline ?? false;
    return session;
  }

  // Fingerprint unlock: recovers the data key from this device's record with
  // the passkey's PRF output instead of running the password KDF. The
  // keyfile is still required — the record's wrap key is derived from it
  // too, and later password checks / password changes need it.
  static async fromRemoteWithDevice(
    remote: RemoteVault,
    record: DeviceUnlockRecord,
    prf: Uint8Array,
    keyfile: Uint8Array,
    targetKdf?: KdfTarget,
  ): Promise<VaultSession> {
    const envelope = parseEnvelope(remote.contents);
    const { kid } = await keyfileFromKey(keyfile);
    if (record.kid !== kid) {
      throw new DeviceUnlockError(DEVICE_UNLOCK_FAILED_MESSAGE);
    }
    const dataKey = await unwrapDeviceDataKey(record, headerOf(envelope), prf, keyfile);
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
      targetKdf,
    );
    session.offline = remote.offline ?? false;
    return session;
  }

  static async create(
    secrets: VaultSecrets,
    plaintext: Uint8Array,
    targetKdf?: KdfTarget,
  ): Promise<VaultSession> {
    const engine = defaultEngine();
    const init = await engine.initNew(secrets, targetKdf);
    const envelope = await engine.encrypt(init.header, init.dataKey, plaintext);
    const meta = await uploadVault(null, null, serializeEnvelope(envelope));
    return new VaultSession(
      meta.fileId,
      meta.modifiedTime,
      envelope,
      init.dataKey,
      plaintext,
      secrets.keyfile,
      targetKdf,
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

  // Vault's stored Argon2id cost is below the configured target (operator
  // raised PORTUNUS_KDF_*): a password-confirmed save re-wraps it stronger.
  // Monotonic — never fires to weaken a vault. No target configured → never.
  get needsKdfUpgrade(): boolean {
    if (!this.targetKdf) return false;
    return kdfNeedsUpgrade(
      headerOf(this.envelope),
      this.targetKdf,
      defaultEngine().id,
    );
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
      keyfile: this.keyfile,
      meta,
      now,
    });
  }

  // Fingerprint re-check (e.g. confirming a save): the record must belong
  // to the current header and yield the held data key.
  async verifyDevice(record: DeviceUnlockRecord, prf: Uint8Array): Promise<void> {
    const header = headerOf(this.envelope);
    await assertDeviceRecordCurrent(record, header);
    const dataKey = await unwrapDeviceDataKey(record, header, prf, this.keyfile);
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
    // An engine upgrade is mandatory (deprecated crypto) and hard-requires
    // the password. A KDF cost upgrade is a best-effort tuning improvement:
    // take it when the save already carries the password, but never block an
    // otherwise-valid save (e.g. one confirmed by biometrics) for it — it
    // retries on the next password-confirmed save.
    if (this.needsEngineUpgrade || (this.needsKdfUpgrade && password)) {
      if (!password) {
        throw new PasswordRequiredError(ENGINE_UPGRADE_PASSWORD_REQUIRED_MESSAGE);
      }
      // Re-wrapping under a mistyped password would lock the owner out —
      // it must unlock the current header first.
      await this.verifyPassword(password);
      const init = await defaultEngine().initNew(
        { password, keyfile: this.keyfile },
        this.targetKdf,
      );
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
    const init = await engine.initNew(
      { password: newPassword, keyfile: this.keyfile },
      this.targetKdf,
    );
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
