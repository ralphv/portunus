// Server-only (node:crypto): imported by the /api/vault route and the boot
// check, never by client code.
import {
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";

import { isDemoMode } from "./demo-mode";

// Server-side tamper detection for the Drive vault file: the serialized
// envelope string is signed with Ed25519 on PUT and verified on GET, so an
// edit made directly in Drive (or by anything else holding a drive.file token)
// is rejected before the client sees it. The client never signs or verifies.

export const SIGNING_KEY_ENV = "PORTUNUS_SIGNING_PRIVATE_KEY";
export const SIGNATURES_DISABLED_ENV = "PORTUNUS_SIGNATURES_DISABLED";
export const ALLOW_MISSING_SIGNATURE_ENV = "PORTUNUS_ALLOW_MISSING_SIGNATURE";

function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true";
}

export function isSigningEnabled(): boolean {
  return !isDemoMode() && !envFlag(SIGNATURES_DISABLED_ENV);
}

export function isMissingSignatureAllowed(): boolean {
  return envFlag(ALLOW_MISSING_SIGNATURE_ENV);
}

export class SigningKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SigningKeyError";
  }
}

type Keys = { privateKey: KeyObject; publicKey: KeyObject };

// Cached per raw env value, so a changed value (tests, hot reload) re-parses.
let cached: { raw: string; keys: Keys } | null = null;

// Format: base64 of the DER-encoded PKCS#8 Ed25519 private key, on one line
// (`openssl pkey -in key.pem -outform DER | base64 | tr -d '\n'`).
function parseKey(raw: string): Keys {
  if (raw.includes("-----BEGIN")) {
    throw new SigningKeyError(
      `${SIGNING_KEY_ENV} must be base64 DER (PKCS#8), not PEM — convert with ` +
        "`openssl pkey -in key.pem -outform DER | base64 | tr -d '\\n'`.",
    );
  }
  const b64 = raw.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    throw new SigningKeyError(`${SIGNING_KEY_ENV} is not valid base64.`);
  }
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({
      key: Buffer.from(b64, "base64"),
      format: "der",
      type: "pkcs8",
    });
  } catch {
    throw new SigningKeyError(
      `${SIGNING_KEY_ENV} is not a valid PKCS#8 private key (base64 DER).`,
    );
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new SigningKeyError(
      `${SIGNING_KEY_ENV} must be an Ed25519 key, got ${privateKey.asymmetricKeyType ?? "unknown"}.`,
    );
  }
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

function loadKeys(): Keys {
  const raw = process.env[SIGNING_KEY_ENV]?.trim();
  if (!raw) {
    throw new SigningKeyError(
      `${SIGNING_KEY_ENV} is not set. Vault signatures are enabled by default — ` +
        `generate a key (see README "Vault signatures") or set ${SIGNATURES_DISABLED_ENV}=1.`,
    );
  }
  if (cached?.raw !== raw) cached = { raw, keys: parseKey(raw) };
  return cached.keys;
}

// Boot-time check (instrumentation.ts): fail fast when signatures are enabled
// but the key is missing or unusable. Also required during migration
// (PORTUNUS_ALLOW_MISSING_SIGNATURE), since every PUT still signs.
export function assertSigningRequirements(): void {
  if (isSigningEnabled()) loadKeys();
}

// Returns the base64 Ed25519 signature over the UTF-8 bytes of `contents`,
// or "" when signing is disabled (demo mode / PORTUNUS_SIGNATURES_DISABLED).
export async function signPayload(contents: string): Promise<string> {
  if (!isSigningEnabled()) return "";
  const { privateKey } = loadKeys();
  return sign(null, Buffer.from(contents, "utf8"), privateKey).toString("base64");
}

// Always true when signing is disabled. Malformed signatures return false.
export async function verifyPayload(
  contents: string,
  signatureB64: string,
): Promise<boolean> {
  if (!isSigningEnabled()) return true;
  const { publicKey } = loadKeys();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureB64)) return false;
  const signature = Buffer.from(signatureB64, "base64");
  if (signature.length !== 64) return false;
  try {
    return verify(null, Buffer.from(contents, "utf8"), publicKey, signature);
  } catch {
    return false;
  }
}

export type SignedVaultFile = { payload: string; signature: string };

export function wrapSigned(payload: string, signature: string): string {
  return JSON.stringify({ payload, signature } satisfies SignedVaultFile);
}

// Classifies what's stored in Drive. Anything carrying a `payload` or
// `signature` key is treated as a wrapper (a half-stripped wrapper must not
// pass as a legacy envelope); everything else is a legacy bare envelope.
export type StoredVaultFile =
  | { kind: "signed"; payload: string; signature: string }
  | { kind: "malformed" }
  | { kind: "unsigned"; contents: string };

export function parseStoredVault(stored: string): StoredVaultFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return { kind: "unsigned", contents: stored };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "unsigned", contents: stored };
  }
  const obj = parsed as Record<string, unknown>;
  if (!Object.hasOwn(obj, "payload") && !Object.hasOwn(obj, "signature")) {
    return { kind: "unsigned", contents: stored };
  }
  if (typeof obj.payload !== "string" || typeof obj.signature !== "string") {
    return { kind: "malformed" };
  }
  return { kind: "signed", payload: obj.payload, signature: obj.signature };
}
