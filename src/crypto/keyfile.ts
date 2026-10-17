import { KEYFILE_FILENAME, KEYFILE_STORAGE_KEY } from "@/constants";

import { b64decode, b64encode } from "./base64";
import { InvalidKeyfileError, VaultError } from "./errors";

export { KEYFILE_FILENAME };

export const KEYFILE_FORMAT = "portunus-keyfile";
export const KEYFILE_VERSION = 1;
export const KEYFILE_KEY_BYTES = 32;

const LS_SLOT = KEYFILE_STORAGE_KEY;
const KID_BYTES = 8; // truncated SHA-256 of the key, hex-encoded

export type Keyfile = {
  key: Uint8Array;
  kid: string;
};

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Non-secret fingerprint of the key — safe to display in the UI to identify
// which keyfile is installed on this device.
async function computeKid(key: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    key as Uint8Array<ArrayBuffer>,
  );
  return hex(new Uint8Array(digest).subarray(0, KID_BYTES));
}

export async function generateKeyfile(): Promise<{
  keyfile: Keyfile;
  json: string;
}> {
  const key = crypto.getRandomValues(new Uint8Array(KEYFILE_KEY_BYTES));
  const keyfile: Keyfile = { key, kid: await computeKid(key) };
  return { keyfile, json: serializeKeyfile(keyfile) };
}

export function serializeKeyfile(keyfile: Keyfile): string {
  return JSON.stringify(
    {
      format: KEYFILE_FORMAT,
      version: KEYFILE_VERSION,
      kid: keyfile.kid,
      key: b64encode(keyfile.key),
    },
    null,
    2,
  );
}

export async function parseKeyfile(text: string): Promise<Keyfile> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new InvalidKeyfileError("Keyfile is not valid JSON");
  }
  const obj = raw as Record<string, unknown> | null;
  if (
    obj === null ||
    typeof obj !== "object" ||
    obj.format !== KEYFILE_FORMAT ||
    obj.version !== KEYFILE_VERSION ||
    typeof obj.key !== "string"
  ) {
    throw new InvalidKeyfileError("Not a portunus keyfile");
  }
  let key: Uint8Array;
  try {
    key = b64decode(obj.key);
  } catch {
    throw new InvalidKeyfileError("Keyfile key encoding is invalid");
  }
  if (key.length !== KEYFILE_KEY_BYTES) {
    throw new InvalidKeyfileError("Keyfile key has wrong length");
  }
  // A kid present in the file must match the key; absent, we compute it.
  const kid = await computeKid(key);
  if (obj.kid !== undefined && obj.kid !== kid) {
    throw new InvalidKeyfileError("Keyfile fingerprint does not match its key");
  }
  return { key, kid };
}

// Rebuild a Keyfile from raw key bytes — e.g. a recovery code typed in by
// hand (see recovery.ts). The kid is recomputed from the key.
export async function keyfileFromKey(key: Uint8Array): Promise<Keyfile> {
  if (key.length !== KEYFILE_KEY_BYTES) {
    throw new InvalidKeyfileError("Recovery key has wrong length");
  }
  return { key, kid: await computeKid(key) };
}

// --- localStorage install (per-device persistence) ---

export function installKeyfile(keyfile: Keyfile): void {
  if (typeof localStorage === "undefined") {
    throw new VaultError("localStorage is unavailable");
  }
  localStorage.setItem(LS_SLOT, serializeKeyfile(keyfile));
}

export async function loadInstalledKeyfile(): Promise<Keyfile | null> {
  if (typeof localStorage === "undefined") return null;
  const text = localStorage.getItem(LS_SLOT);
  return text === null ? null : parseKeyfile(text);
}

export function uninstallKeyfile(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(LS_SLOT);
}

// --- export ---

export function downloadKeyfile(
  json: string,
  filename = KEYFILE_FILENAME,
): void {
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/json" }),
  );
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
