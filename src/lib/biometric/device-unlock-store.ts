import {
  DEVICE_UNLOCK_DISMISSED_PREFIX,
  DEVICE_UNLOCK_DISMISSED_VALUE,
  DEVICE_UNLOCK_STORAGE_PREFIX,
} from "@/constants";
import {
  parseDeviceUnlockRecord,
  serializeDeviceUnlockRecord,
} from "@/crypto/device-unlock-record";
import type { DeviceUnlockRecord } from "@/crypto/device-unlock-record";

// This device's fingerprint-unlock records in localStorage, one per keyfile
// id. Storage can be missing or throw (private mode, blocked site data):
// reads then find nothing and writes report failure, never crash the UI.

const recordKey = (kid: string) => DEVICE_UNLOCK_STORAGE_PREFIX + kid;
const dismissedKey = (kid: string) => DEVICE_UNLOCK_DISMISSED_PREFIX + kid;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// A record that fails its checks is dropped: it could never unlock anything.
export function readDeviceUnlock(kid: string): DeviceUnlockRecord | null {
  const s = storage();
  try {
    const text = s?.getItem(recordKey(kid));
    if (text == null) return null;
    const record = parseDeviceUnlockRecord(text);
    if (record.kid === kid) return record;
  } catch {
    // Unreadable or invalid — fall through and drop it.
  }
  removeDeviceUnlock(kid);
  return null;
}

export function writeDeviceUnlock(record: DeviceUnlockRecord): void {
  storage()?.setItem(recordKey(record.kid), serializeDeviceUnlockRecord(record));
  // Enrolled: the "set up?" offer has been answered.
  clearDeviceUnlockDismissed(record.kid);
}

export function removeDeviceUnlock(kid: string): void {
  try {
    storage()?.removeItem(recordKey(kid));
  } catch {
    // Nothing to remove.
  }
}

// Every record and offer answer on this device (the feature was turned off).
export function purgeDeviceUnlocks(): void {
  const s = storage();
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (
        k?.startsWith(DEVICE_UNLOCK_STORAGE_PREFIX) ||
        k?.startsWith(DEVICE_UNLOCK_DISMISSED_PREFIX)
      ) {
        keys.push(k);
      }
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    // Storage unavailable — nothing stored either.
  }
}

export function isDeviceUnlockDismissed(kid: string): boolean {
  try {
    return storage()?.getItem(dismissedKey(kid)) === DEVICE_UNLOCK_DISMISSED_VALUE;
  } catch {
    return false;
  }
}

export function dismissDeviceUnlock(kid: string): void {
  try {
    storage()?.setItem(dismissedKey(kid), DEVICE_UNLOCK_DISMISSED_VALUE);
  } catch {
    // The offer just comes back next time.
  }
}

function clearDeviceUnlockDismissed(kid: string): void {
  try {
    storage()?.removeItem(dismissedKey(kid));
  } catch {
    // Nothing to clear.
  }
}
