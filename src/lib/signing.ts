// Server-only (node:crypto): imported by the /api/vault route and the boot
// check, never by client code.
import {
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";

import {
  LOG_VAULT_ACCEPTED_UNSIGNED,
  LOG_VAULT_REJECTED_FORMAT,
  LOG_VAULT_REJECTED_SIGNATURE,
  VAULT_WRAPPER_VERSION_BOUND,
  WRAPPER_SIGNATURE_CONTEXT_V2,
  WRAPPER_SIGNATURE_CONTEXT_V3,
  WRAPPER_SIGNATURE_RESERVED_PREFIXES,
} from "@/constants";
import { createSchemaValidatorFactory } from "@/factory";
import {
  storedVaultWrapperSchema,
  type VaultTotpBlock,
} from "@/lib/schemas/stored-vault-wrapper.schema";

import { isDemoMode } from "./demo-mode";

const validator = createSchemaValidatorFactory();

// Server-side tamper detection for the Drive vault file: the serialized
// envelope string (bound to its Drive file id) is signed with Ed25519 on PUT
// and verified on GET, so an edit made directly in Drive (or by anything else
// holding a drive.file token), or a wrapper copied from another file, is
// rejected before the client sees it. The client never signs or verifies.

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
// checks codes against it before serving the payload. Its shape and type
// come from src/lib/schemas/stored-vault-wrapper.schema.ts.
export type { VaultTotpBlock };

// What a signature covers.
//
// Current format (wrapper `version: 3`, every signature written now): the v3
// domain tag, then canonical JSON of `{ fileId, payload, totp? }` in that key
// order. Binding the Drive file id means a wrapper signed for one file (or
// one account's file) does not verify as any other file, and PUT can only
// mint signatures for the caller's own vault file.
//
// Legacy formats (no `version` field; verified on read, never written):
// a bare payload, or the v2 domain tag + `{ payload, totp }` when a totp
// block is present. A file in a legacy format is re-signed in the current
// format on its next save.
export function boundSignedMessage(
  fileId: string,
  payload: string,
  totp?: VaultTotpBlock,
): string {
  const body = totp
    ? { fileId, payload, totp: { secret: totp.secret } }
    : { fileId, payload };
  return WRAPPER_SIGNATURE_CONTEXT_V3 + JSON.stringify(body);
}

// The legacy signed message, or null when `payload` could be mistaken for a
// tagged message: a bare payload starting with a reserved domain tag would
// let a v2/v3 signature (version field deleted) pass as a legacy one.
export function legacySignedMessage(
  payload: string,
  totp?: VaultTotpBlock,
): string | null {
  if (totp) {
    return WRAPPER_SIGNATURE_CONTEXT_V2 + JSON.stringify({ payload, totp: { secret: totp.secret } });
  }
  return hasReservedPrefix(payload) ? null : payload;
}

export function hasReservedPrefix(contents: string): boolean {
  return WRAPPER_SIGNATURE_RESERVED_PREFIXES.some((p) => contents.startsWith(p));
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
  version?: typeof VAULT_WRAPPER_VERSION_BOUND;
  payload: string;
  totp?: VaultTotpBlock;
  signature: string;
};

// `bound` marks a current-format (file-id-bound) signature; false writes a
// legacy-shaped wrapper (no version field), used only for the unsigned
// wrapper kept when signatures are disabled, and by tests.
export function wrapSigned(
  payload: string,
  signature: string,
  totp?: VaultTotpBlock,
  bound = false,
): string {
  const file: SignedVaultFile = {
    ...(bound ? { version: VAULT_WRAPPER_VERSION_BOUND } : {}),
    payload,
    ...(totp ? { totp: { secret: totp.secret } } : {}),
    signature,
  };
  return JSON.stringify(file);
}

// The Drive file contents for `payload` (+ optional totp block), to be
// stored as file `fileId`. Signed in the current format unless signatures
// are disabled; then a bare envelope, or an unsigned wrapper when a totp
// block must be kept (not integrity-protected).
export async function serializeStoredVault(
  fileId: string,
  payload: string,
  totp?: VaultTotpBlock,
): Promise<string> {
  if (isSigningEnabled()) {
    const signature = await signPayload(boundSignedMessage(fileId, payload, totp));
    return wrapSigned(payload, signature, totp, true);
  }
  return totp ? wrapSigned(payload, "", totp) : payload;
}

// Classifies what's stored in Drive. Anything carrying a `payload`,
// `signature` or `totp` key is treated as a wrapper (a half-stripped wrapper
// must not pass as a legacy envelope); everything else is a legacy bare
// envelope. (`version` is not a classifier: bare envelopes carry their own.)
export type StoredVaultFile =
  | {
      kind: "signed";
      bound: boolean;
      payload: string;
      signature: string;
      totp?: VaultTotpBlock;
    }
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
  if (
    !Object.hasOwn(obj, "payload") &&
    !Object.hasOwn(obj, "signature") &&
    !Object.hasOwn(obj, "totp")
  ) {
    return { kind: "unsigned", contents: stored };
  }
  const wrapper = validator.check(storedVaultWrapperSchema, obj);
  if (!wrapper.ok) return { kind: "malformed" };
  const { version, payload, signature, totp } = wrapper.value;
  const bound = version === VAULT_WRAPPER_VERSION_BOUND;
  return totp
    ? { kind: "signed", bound, payload, signature, totp: { secret: totp.secret } }
    : { kind: "signed", bound, payload, signature };
}

// Checks a signed wrapper read from file `fileId`. The wrapper's own
// `version` picks the one format tried — formats are never tried blindly.
async function verifyStoredSignature(
  fileId: string,
  file: Extract<StoredVaultFile, { kind: "signed" }>,
): Promise<boolean> {
  const message = file.bound
    ? boundSignedMessage(fileId, file.payload, file.totp)
    : legacySignedMessage(file.payload, file.totp);
  return message !== null && verifyPayload(message, file.signature);
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
    if (await verifyStoredSignature(fileId, file)) {
      return file.totp ? { payload: file.payload, totp: file.totp } : { payload: file.payload };
    }
    console.error(`${LOG_VAULT_REJECTED_SIGNATURE} (${fileId})`);
    return null;
  }
  if (file.kind === "unsigned" && isMissingSignatureAllowed()) {
    console.warn(`${LOG_VAULT_ACCEPTED_UNSIGNED} (${fileId})`);
    return { payload: stored };
  }
  console.error(`${LOG_VAULT_REJECTED_FORMAT} (${fileId}: ${file.kind})`);
  return null;
}
