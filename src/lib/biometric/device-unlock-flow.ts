import { DeviceUnlockStaleError } from "@/crypto/errors";
import type { DeviceUnlockRecord } from "@/crypto/device-unlock-record";
import type { Keyfile } from "@/crypto/keyfile";
import { VaultClient } from "@/lib/vault-client";
import type { UnlockedVault, VaultWorkerLike } from "@/lib/vault-client";
import type { RemoteVault, VaultCachePolicy } from "@/lib/vault-remote";

import type { BiometricInterface } from "./biometric-interface";
import {
  readDeviceUnlock,
  removeDeviceUnlock,
  writeDeviceUnlock,
} from "./device-unlock-store";

// The biometric-unlock moves the UI makes, tying the passkey check
// (BiometricInterface), the vault Worker and this device's stored record
// together. The PRF secret goes straight from the check to the Worker.

// Re-checks the master password first, so a typo doesn't leave a new
// passkey behind; the Worker checks it again before wrapping the key.
export async function enrollThisDevice(
  client: VaultClient,
  biometric: BiometricInterface,
  password: string,
  kid: string,
): Promise<DeviceUnlockRecord> {
  await client.call("verifyPassword", password);
  const { credentialId, prfSalt, prf } = await biometric.enroll(kid);
  let record: DeviceUnlockRecord;
  try {
    record = await client.call("enrollDevice", password, prf, {
      kid,
      credentialId,
      prfSalt,
    });
  } catch (e) {
    await biometric.forget(credentialId);
    throw e;
  } finally {
    prf.fill(0);
  }
  // A previous enrollment on this device is replaced.
  const previous = readDeviceUnlock(kid);
  writeDeviceUnlock(record);
  if (previous && previous.credentialId !== credentialId) {
    await biometric.forget(previous.credentialId);
  }
  return record;
}

// The biometric check runs first, then `getRemote` fetches the vault: on a
// two-factor vault the fetch spends the code, so a cancelled check must not
// come after it. Returns null when there is no vault (getRemote → null).
export async function unlockWithThisDevice(
  getRemote: () => Promise<RemoteVault | null>,
  record: DeviceUnlockRecord,
  keyfile: Keyfile,
  biometric: BiometricInterface,
  cachePolicy: VaultCachePolicy,
  spawn?: () => VaultWorkerLike,
): Promise<UnlockedVault | null> {
  const prf = await biometric.evaluate(record.credentialId, record.prfSalt);
  try {
    const remote = await getRemote();
    if (!remote) return null;
    return await VaultClient.openWithDevice(
      remote,
      record,
      prf,
      keyfile.key,
      cachePolicy,
      spawn,
    );
  } catch (e) {
    await dropIfStale(e, record, biometric);
    throw e;
  } finally {
    prf.fill(0);
  }
}

// Biometrics in place of re-typing the master password (save dialog).
export async function confirmWithThisDevice(
  client: VaultClient,
  record: DeviceUnlockRecord,
  biometric: BiometricInterface,
): Promise<void> {
  const prf = await biometric.evaluate(record.credentialId, record.prfSalt);
  try {
    await client.call("verifyDevice", record, prf);
  } catch (e) {
    await dropIfStale(e, record, biometric);
    throw e;
  } finally {
    prf.fill(0);
  }
}

// No password needed: removing only takes access away.
export async function removeThisDevice(
  kid: string,
  biometric: BiometricInterface,
): Promise<void> {
  const record = readDeviceUnlock(kid);
  removeDeviceUnlock(kid);
  if (record) await biometric.forget(record.credentialId);
}

// A stale record (the master password changed) can never work again.
async function dropIfStale(
  e: unknown,
  record: DeviceUnlockRecord,
  biometric: BiometricInterface,
): Promise<void> {
  if (e instanceof DeviceUnlockStaleError) {
    removeDeviceUnlock(record.kid);
    await biometric.forget(record.credentialId);
  }
}
