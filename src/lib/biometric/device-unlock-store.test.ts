import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEVICE_UNLOCK_STORAGE_PREFIX } from "@/constants";
import { b64encode } from "@/crypto/base64";
import { generatePrfSalt } from "@/crypto/device-unlock-record";
import type { DeviceUnlockRecord } from "@/crypto/device-unlock-record";
import { installVaultApiStub } from "@/lib/vault-api-stub.test-helper";

import {
  dismissDeviceUnlock,
  isDeviceUnlockDismissed,
  purgeDeviceUnlocks,
  readDeviceUnlock,
  removeDeviceUnlock,
  writeDeviceUnlock,
} from "./device-unlock-store";

const KID = "0123456789abcdef";

function record(kid = KID): DeviceUnlockRecord {
  return {
    format: "portunus-device-unlock",
    version: 1,
    kid,
    credentialId: b64encode(new Uint8Array(16).fill(1)),
    prfSalt: generatePrfSalt(),
    headerDigest: "a".repeat(64),
    createdAt: new Date(0).toISOString(),
    nonce: b64encode(new Uint8Array(24)),
    wrappedDataKey: b64encode(new Uint8Array(48)),
  };
}

beforeEach(() => {
  installVaultApiStub(); // in-memory localStorage
});

describe("device unlock store", () => {
  it("writes, reads and removes a record per keyfile id", () => {
    const r = record();
    writeDeviceUnlock(r);
    expect(readDeviceUnlock(KID)).toEqual(r);
    expect(readDeviceUnlock("fedcba9876543210")).toBeNull();
    removeDeviceUnlock(KID);
    expect(readDeviceUnlock(KID)).toBeNull();
  });

  it("drops an invalid record", () => {
    localStorage.setItem(DEVICE_UNLOCK_STORAGE_PREFIX + KID, "{nope");
    expect(readDeviceUnlock(KID)).toBeNull();
    expect(localStorage.getItem(DEVICE_UNLOCK_STORAGE_PREFIX + KID)).toBeNull();
  });

  it("drops a record stored under another keyfile id", () => {
    localStorage.setItem(
      DEVICE_UNLOCK_STORAGE_PREFIX + KID,
      JSON.stringify(record("fedcba9876543210")),
    );
    expect(readDeviceUnlock(KID)).toBeNull();
  });

  it("remembers 'Not now' until the device is enrolled", () => {
    expect(isDeviceUnlockDismissed(KID)).toBe(false);
    dismissDeviceUnlock(KID);
    expect(isDeviceUnlockDismissed(KID)).toBe(true);
    writeDeviceUnlock(record());
    expect(isDeviceUnlockDismissed(KID)).toBe(false);
  });

  it("purges every record and answer, and nothing else", () => {
    // The stub's storage has no length/key(): give it a real-ish one.
    const mem = new Map<string, string>();
    const s = {
      get length() {
        return mem.size;
      },
      key: (i: number) => [...mem.keys()][i] ?? null,
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    vi.stubGlobal("localStorage", s);
    writeDeviceUnlock(record());
    dismissDeviceUnlock("fedcba9876543210");
    localStorage.setItem("portunus.keyfile", "keep");
    purgeDeviceUnlocks();
    expect([...mem.keys()]).toEqual(["portunus.keyfile"]);
  });

  it("survives storage that throws", () => {
    const throwing = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };
    vi.stubGlobal("localStorage", throwing);
    expect(readDeviceUnlock(KID)).toBeNull();
    expect(isDeviceUnlockDismissed(KID)).toBe(false);
    expect(() => dismissDeviceUnlock(KID)).not.toThrow();
    expect(() => purgeDeviceUnlocks()).not.toThrow();
  });
});
