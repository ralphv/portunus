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

// No side effects (it runs during render): a record that fails its checks
// reads as none. It could never unlock anything, and the next enrollment
// or removal overwrites or deletes it.
export function readDeviceUnlock(kid: string): DeviceUnlockRecord | null {
  try {
    const text = storage()?.getItem(recordKey(kid));
    if (text == null) return null;
    const record = parseDeviceUnlockRecord(text);
    return record.kid === kid ? record : null;
  } catch {
    return null;
  }
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
// Returns the passkeys' credential ids, so the caller can let the passkey
// manager forget them.
export function purgeDeviceUnlocks(): string[] {
  const s = storage();
  if (!s) return [];
  const credentialIds: string[] = [];
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
    for (const k of keys) {
      if (k.startsWith(DEVICE_UNLOCK_STORAGE_PREFIX)) {
        try {
          credentialIds.push(parseDeviceUnlockRecord(s.getItem(k) ?? "").credentialId);
        } catch {
          // Not a valid record — nothing to forget.
        }
      }
      s.removeItem(k);
    }
  } catch {
    // Storage unavailable — nothing stored either.
  }
  return credentialIds;
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
