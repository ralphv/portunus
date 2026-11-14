import sodium from "libsodium-wrappers";

import {
  DEVICE_UNLOCK_DIGEST_EXCLUDED_FIELDS,
  DEVICE_UNLOCK_FAILED_MESSAGE,
  DEVICE_UNLOCK_FORMAT,
  DEVICE_UNLOCK_HKDF_INFO,
  DEVICE_UNLOCK_INVALID_MESSAGE,
  DEVICE_UNLOCK_KEY_BYTES,
  DEVICE_UNLOCK_PRF_BYTES,
  DEVICE_UNLOCK_SALT_BYTES,
  DEVICE_UNLOCK_STALE_MESSAGE,
  DEVICE_UNLOCK_VERSION,
} from "@/constants";

import { aadBytes, canonicalJson } from "./aad";
import { b64decode, b64encode } from "./base64";
import { DeviceUnlockError, DeviceUnlockStaleError } from "./errors";
import type { VaultHeader } from "./types";

// Fingerprint (device) unlock: an enrolled device keeps, in its own
// localStorage, a copy of the vault's DATA KEY encrypted under a key derived
// from a WebAuthn passkey's PRF output — a secret the authenticator releases
// only after user verification (fingerprint, face, or the device PIN).
//
// The vault file is never touched: its data key stays wrapped by
// Argon2id(password ‖ keyfile), so the password path keeps working on every
// device. The master password is never stored, so passing the device check
// can't reveal it.
//
// The record is bound (AEAD AAD) to the keyfile id, the passkey, and a digest
// of the vault header it was made for. A password change or engine upgrade
// writes a new header with a fresh data key, so old records are detected as
// stale up front instead of failing as a wrong secret.

const NONCE_BYTES = 24; // XChaCha20-Poly1305
// Poly1305 tag; a constant so record checks need no sodium.ready.
const TAG_BYTES = 16;
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

const te = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// SHA-256 over the canonical header (envelope minus per-save fields). Any
// change to the key wrap — new password, new data key, new engine or KDF
// params — changes it.
export async function vaultHeaderDigest(header: VaultHeader): Promise<string> {
  const h: Record<string, unknown> = { ...header };
  for (const f of DEVICE_UNLOCK_DIGEST_EXCLUDED_FIELDS) delete h[f];
  const digest = await crypto.subtle.digest(
    "SHA-256",
    te.encode(canonicalJson(h)) as Uint8Array<ArrayBuffer>,
  );
  return hex(new Uint8Array(digest));
}

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

// Everything but the nonce and ciphertext is authenticated.
function recordAad(r: Omit<DeviceUnlockRecord, "nonce" | "wrappedDataKey">) {
  return aadBytes({
    format: r.format,
    version: r.version,
    kid: r.kid,
    credentialId: r.credentialId,
    prfSalt: r.prfSalt,
    headerDigest: r.headerDigest,
    createdAt: r.createdAt,
  });
}

// HKDF-SHA256(prf, salt = prfSalt, info) → 32-byte wrap key.
async function deriveWrapKey(prf: Uint8Array, prfSalt: string): Promise<Uint8Array> {
  if (prf.length !== DEVICE_UNLOCK_PRF_BYTES) {
    throw new DeviceUnlockError(DEVICE_UNLOCK_FAILED_MESSAGE);
  }
  const ikm = await crypto.subtle.importKey(
    "raw",
    prf as Uint8Array<ArrayBuffer>,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: b64decode(prfSalt) as Uint8Array<ArrayBuffer>,
      info: te.encode(DEVICE_UNLOCK_HKDF_INFO) as Uint8Array<ArrayBuffer>,
    },
    ikm,
    DEVICE_UNLOCK_KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function wrapDataKeyForDevice(args: {
  dataKey: Uint8Array;
  header: VaultHeader;
  prf: Uint8Array;
  meta: DeviceUnlockMeta;
  now?: Date;
}): Promise<DeviceUnlockRecord> {
  await sodium.ready;
  const head = {
    format: DEVICE_UNLOCK_FORMAT,
    version: DEVICE_UNLOCK_VERSION,
    kid: args.meta.kid,
    credentialId: args.meta.credentialId,
    prfSalt: args.meta.prfSalt,
    headerDigest: await vaultHeaderDigest(args.header),
    createdAt: (args.now ?? new Date()).toISOString(),
  };
  const key = await deriveWrapKey(args.prf, head.prfSalt);
  try {
    const nonce = sodium.randombytes_buf(NONCE_BYTES);
    const wrapped = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      args.dataKey,
      recordAad(head),
      null,
      nonce,
      key,
    );
    // Round-trip through the validator so a bad meta (e.g. kid) fails here,
    // at enrollment, not at the next unlock.
    return checkDeviceUnlockRecord({
      ...head,
      nonce: b64encode(nonce),
      wrappedDataKey: b64encode(wrapped),
    });
  } finally {
    key.fill(0);
  }
}

// Throws DeviceUnlockStaleError when `record` was made for another header —
// checked before any crypto, so a stale record never reads as a wrong secret.
export async function assertDeviceRecordCurrent(
  record: DeviceUnlockRecord,
  header: VaultHeader,
): Promise<void> {
  if (record.headerDigest !== (await vaultHeaderDigest(header))) {
    throw new DeviceUnlockStaleError(DEVICE_UNLOCK_STALE_MESSAGE);
  }
}

// Recovers the data key for `header` from `record` with the passkey's PRF
// output. Throws DeviceUnlockStaleError (record is for an older header) or
// DeviceUnlockError (wrong secret / tampered record).
export async function unwrapDeviceDataKey(
  record: DeviceUnlockRecord,
  header: VaultHeader,
  prf: Uint8Array,
): Promise<Uint8Array> {
  const r = checkDeviceUnlockRecord(record);
  await assertDeviceRecordCurrent(r, header);
  await sodium.ready;
  const key = await deriveWrapKey(prf, r.prfSalt);
  try {
    const dataKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      b64decode(r.wrappedDataKey),
      recordAad(r),
      b64decode(r.nonce),
      key,
    );
    if (!dataKey?.length) throw new Error();
    return dataKey;
  } catch {
    throw new DeviceUnlockError(DEVICE_UNLOCK_FAILED_MESSAGE);
  } finally {
    key.fill(0);
  }
}

// Constant-time equality for key material.
export async function sameKey(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  await sodium.ready;
  return a.length === b.length && sodium.memcmp(a, b);
}
