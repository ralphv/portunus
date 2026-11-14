import {
  DEVICE_UNLOCK_FORMAT,
  DEVICE_UNLOCK_INVALID_MESSAGE,
  DEVICE_UNLOCK_SALT_BYTES,
  DEVICE_UNLOCK_VERSION,
} from "@/constants";

import { b64decode, b64encode } from "./base64";
import { DeviceUnlockError } from "./errors";

// The per-device fingerprint-unlock record (see device-unlock.ts) and its
// checks. Kept free of libsodium so the main thread can read and validate
// records from localStorage without loading the crypto engines.

const NONCE_BYTES = 24; // XChaCha20-Poly1305
const TAG_BYTES = 16; // Poly1305
const KID_RE = /^[0-9a-f]{16}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;

export type DeviceUnlockRecord = {
  format: string;
  version: number;
  // Keyfile id the record belongs to (see keyfile.ts).
  kid: string;
  // WebAuthn credential id (b64url) and the PRF salt (b64url) to evaluate.
  credentialId: string;
  prfSalt: string;
  // vaultHeaderDigest() of the header the wrapped data key belongs to.
  headerDigest: string;
  createdAt: string;
  nonce: string;
  wrappedDataKey: string;
};

// What the WebAuthn side supplies at enrollment.
export type DeviceUnlockMeta = {
  kid: string;
  credentialId: string;
  prfSalt: string;
};

export function generatePrfSalt(): string {
  return b64encode(crypto.getRandomValues(new Uint8Array(DEVICE_UNLOCK_SALT_BYTES)));
}

function decodeExact(s: string, length: number): Uint8Array {
  const bytes = b64decode(s);
  if (bytes.length !== length) throw new Error();
  return bytes;
}

// Validates a record from localStorage or a Worker message (browser input —
// hand-checked like the keyfile and envelope, per AGENTS.md).
export function checkDeviceUnlockRecord(raw: unknown): DeviceUnlockRecord {
  const r = raw as Partial<DeviceUnlockRecord> | null;
  const ok =
    r !== null &&
    typeof r === "object" &&
    !Array.isArray(r) &&
    r.format === DEVICE_UNLOCK_FORMAT &&
    r.version === DEVICE_UNLOCK_VERSION &&
    typeof r.kid === "string" &&
    KID_RE.test(r.kid) &&
    typeof r.credentialId === "string" &&
    r.credentialId !== "" &&
    typeof r.prfSalt === "string" &&
    typeof r.headerDigest === "string" &&
    DIGEST_RE.test(r.headerDigest) &&
    typeof r.createdAt === "string" &&
    typeof r.nonce === "string" &&
    typeof r.wrappedDataKey === "string";
  if (!ok) throw new DeviceUnlockError(DEVICE_UNLOCK_INVALID_MESSAGE);
  try {
    b64decode(r.credentialId!);
    decodeExact(r.prfSalt!, DEVICE_UNLOCK_SALT_BYTES);
    decodeExact(r.nonce!, NONCE_BYTES);
    if (b64decode(r.wrappedDataKey!).length <= TAG_BYTES) throw new Error();
  } catch {
    throw new DeviceUnlockError(DEVICE_UNLOCK_INVALID_MESSAGE);
  }
  // Copy only the known fields — extra ones never ride along.
  return {
    format: r.format!,
    version: r.version!,
    kid: r.kid!,
    credentialId: r.credentialId!,
    prfSalt: r.prfSalt!,
    headerDigest: r.headerDigest!,
    createdAt: r.createdAt!,
    nonce: r.nonce!,
    wrappedDataKey: r.wrappedDataKey!,
  };
}

export function parseDeviceUnlockRecord(text: string): DeviceUnlockRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DeviceUnlockError(DEVICE_UNLOCK_INVALID_MESSAGE);
  }
  return checkDeviceUnlockRecord(raw);
}

export function serializeDeviceUnlockRecord(record: DeviceUnlockRecord): string {
  return JSON.stringify(record);
}
