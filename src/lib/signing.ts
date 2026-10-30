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

// Optional two-factor block carried beside the payload in the signed wrapper
// (outside the encrypted document). Server-visible by design: the server
// checks codes against it before serving the payload.
export type VaultTotpBlock = { secret: string };

// Domain tag for wrappers that carry a totp block, so their signed message
// can never equal a bare envelope string (envelopes are JSON objects).
export const WRAPPER_SIGNATURE_CONTEXT = "portunus-vault-wrapper:v2\n";

// What the signature covers. A wrapper without a totp block signs the bare
// payload (unchanged from the original format, so existing vaults verify);
// with one, the payload and the totp block together — stripping or swapping
// the block breaks the signature.
export function signedMessage(payload: string, totp?: VaultTotpBlock): string {
  if (!totp) return payload;
  return WRAPPER_SIGNATURE_CONTEXT + JSON.stringify({ payload, totp: { secret: totp.secret } });
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

export type SignedVaultFile = {
  payload: string;
  totp?: VaultTotpBlock;
  signature: string;
};

export function wrapSigned(
  payload: string,
  signature: string,
  totp?: VaultTotpBlock,
): string {
  const file: SignedVaultFile = totp
    ? { payload, totp: { secret: totp.secret }, signature }
    : { payload, signature };
  return JSON.stringify(file);
}

// The Drive file contents for `payload` (+ optional totp block). Signed
// unless signatures are disabled; then a bare envelope, or an unsigned
// wrapper when a totp block must be kept (not integrity-protected).
export async function serializeStoredVault(
  payload: string,
  totp?: VaultTotpBlock,
): Promise<string> {
  if (isSigningEnabled()) {
    return wrapSigned(payload, await signPayload(signedMessage(payload, totp)), totp);
  }
  return totp ? wrapSigned(payload, "", totp) : payload;
}

// Classifies what's stored in Drive. Anything carrying a `payload`,
// `signature` or `totp` key is treated as a wrapper (a half-stripped wrapper
// must not pass as a legacy envelope); everything else is a legacy bare
// envelope.
export type StoredVaultFile =
  | { kind: "signed"; payload: string; signature: string; totp?: VaultTotpBlock }
  | { kind: "malformed" }
  | { kind: "unsigned"; contents: string };

function parseTotpBlock(v: unknown): VaultTotpBlock | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  const secret = (v as Record<string, unknown>).secret;
  if (keys.length !== 1 || typeof secret !== "string" || !secret) return null;
  return { secret };
}

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
  if (
    !Object.hasOwn(obj, "payload") &&
    !Object.hasOwn(obj, "signature") &&
    !Object.hasOwn(obj, "totp")
  ) {
    return { kind: "unsigned", contents: stored };
  }
  if (typeof obj.payload !== "string" || typeof obj.signature !== "string") {
    return { kind: "malformed" };
  }
  if (!Object.hasOwn(obj, "totp")) {
    return { kind: "signed", payload: obj.payload, signature: obj.signature };
  }
  const totp = parseTotpBlock(obj.totp);
  if (!totp) return { kind: "malformed" };
  return { kind: "signed", payload: obj.payload, signature: obj.signature, totp };
}

export type OpenedVault = { payload: string; totp?: VaultTotpBlock };

// Unwraps the Drive file to the envelope string the client expects (plus its
// totp block), or null when the signature doesn't check out. Signed wrappers
// are still unwrapped with signatures disabled, so turning the feature off
// never breaks a vault.
export async function openStoredVault(
  fileId: string,
  stored: string,
): Promise<OpenedVault | null> {
  const file = parseStoredVault(stored);
  if (!isSigningEnabled()) {
    if (file.kind === "signed") {
      return file.totp ? { payload: file.payload, totp: file.totp } : { payload: file.payload };
    }
    return { payload: stored };
  }
  if (file.kind === "signed") {
    if (await verifyPayload(signedMessage(file.payload, file.totp), file.signature)) {
      return file.totp ? { payload: file.payload, totp: file.totp } : { payload: file.payload };
    }
    console.error(`[vault] rejected vault ${fileId}: signature does not verify`);
    return null;
  }
  if (file.kind === "unsigned" && isMissingSignatureAllowed()) {
    console.warn(
      `[vault] accepted unsigned vault ${fileId} (PORTUNUS_ALLOW_MISSING_SIGNATURE=1); it is signed on its next save`,
    );
    return { payload: stored };
  }
  console.error(`[vault] rejected vault ${fileId}: ${file.kind} signature`);
  return null;
}
