import { argon2id } from "hash-wasm";
import sodium from "libsodium-wrappers";

import { aadBytes } from "../aad";
import { b64decode, b64encode } from "../base64";
import {
  MalformedEnvelopeError,
  VaultDecryptError,
  VaultError,
  VaultUnlockError,
} from "../errors";
import { VAULT_FORMAT, VAULT_VERSION } from "../types";
import type {
  EngineInit,
  VaultEnvelope,
  VaultHeader,
  VaultSecrets,
} from "../types";
import type { VaultEngineInterface } from "./interface";

const ENGINE_ID = "argon2id-xchacha20";

const DATA_KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 24; // XChaCha20-Poly1305

// OWASP-recommended Argon2id parameters, stored per-vault in the envelope.
const KDF_TIME = 2;
const KDF_MEM_KIB = 19 * 1024; // 19 MiB
const KDF_LANES = 1;

// Sanity caps on KDF params read from an envelope — the params are
// attacker-controlled until the vault authenticates, so refuse values that
// would turn unlock into a memory/time DoS.
const MAX_KDF_TIME = 16;
const MAX_KDF_MEM_KIB = 256 * 1024;
const MAX_KDF_LANES = 8;

const te = new TextEncoder();

type KdfParamsV1 = {
  algo: "argon2id";
  salt: string;
  time: number;
  mem: number; // KiB
  lanes: number;
};

type HeaderV1 = {
  format: string;
  version: number;
  engine: string;
  kdf: KdfParamsV1;
  wrappedDataKey: string; // b64(nonce || ciphertext) of the wrapped data key
};

type EnvelopeV1 = HeaderV1 & {
  nonce: string;
  ciphertext: string;
};

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function requireSecrets(secrets: VaultSecrets): void {
  if (!secrets.password) throw new VaultError("Master password is required");
  if (!secrets.keyfile?.length) throw new VaultError("Keyfile is required");
}

// AAD bound to the key wrap: everything that selects how the KEK is derived.
function wrapAad(h: Pick<HeaderV1, "format" | "version" | "engine" | "kdf">) {
  return aadBytes({
    format: h.format,
    version: h.version,
    engine: h.engine,
    kdf: h.kdf,
  });
}

// AAD bound to the vault ciphertext: the full header, so swapping the wrapped
// data key (or anything else) between envelopes fails verification.
function vaultAad(h: HeaderV1) {
  return aadBytes({
    format: h.format,
    version: h.version,
    engine: h.engine,
    kdf: h.kdf,
    wrappedDataKey: h.wrappedDataKey,
  });
}

// KEK input: len‖password‖keyfile — length prefix avoids ambiguity between
// (password, keyfile) splits.
function kdfInput(secrets: VaultSecrets): Uint8Array {
  const pw = te.encode(secrets.password);
  const out = new Uint8Array(4 + pw.length + secrets.keyfile.length);
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(
    0,
    pw.length,
  );
  out.set(pw, 4);
  out.set(secrets.keyfile, 4 + pw.length);
  return out;
}

function deriveKek(
  secrets: VaultSecrets,
  kdf: KdfParamsV1,
): Promise<Uint8Array> {
  return argon2id({
    password: kdfInput(secrets),
    salt: b64decode(kdf.salt),
    parallelism: kdf.lanes,
    memorySize: kdf.mem,
    iterations: kdf.time,
    hashLength: DATA_KEY_BYTES,
    outputType: "binary",
  });
}

function parseKdf(raw: unknown): KdfParamsV1 {
  const kdf = raw as Partial<KdfParamsV1> | null;
  if (
    kdf === null ||
    typeof kdf !== "object" ||
    kdf.algo !== "argon2id" ||
    typeof kdf.salt !== "string" ||
    typeof kdf.time !== "number" ||
    typeof kdf.mem !== "number" ||
    typeof kdf.lanes !== "number"
  ) {
    throw new MalformedEnvelopeError("Vault envelope has invalid kdf params");
  }
  if (
    kdf.time < 1 ||
    kdf.time > MAX_KDF_TIME ||
    kdf.mem < 8 ||
    kdf.mem > MAX_KDF_MEM_KIB ||
    kdf.lanes < 1 ||
    kdf.lanes > MAX_KDF_LANES
  ) {
    throw new MalformedEnvelopeError("Vault kdf params out of bounds");
  }
  try {
    if (b64decode(kdf.salt).length !== SALT_BYTES) throw new Error();
  } catch {
    throw new MalformedEnvelopeError("Vault kdf salt is invalid");
  }
  return kdf as KdfParamsV1;
}

function parseHeaderV1(raw: VaultHeader): HeaderV1 {
  if (
    raw.format !== VAULT_FORMAT ||
    raw.version !== VAULT_VERSION ||
    raw.engine !== ENGINE_ID ||
    typeof raw.wrappedDataKey !== "string"
  ) {
    throw new MalformedEnvelopeError("Vault header is not a valid v1 header");
  }
  const header = { ...raw, kdf: parseKdf(raw.kdf) } as HeaderV1;
  try {
    if (b64decode(header.wrappedDataKey).length <= NONCE_BYTES) {
      throw new Error();
    }
  } catch {
    throw new MalformedEnvelopeError("Vault wrapped data key is invalid");
  }
  return header;
}

function parseEnvelopeV1(raw: VaultEnvelope): EnvelopeV1 {
  const header = parseHeaderV1(raw);
  if (
    typeof raw.nonce !== "string" ||
    typeof raw.ciphertext !== "string"
  ) {
    throw new MalformedEnvelopeError("Vault envelope is missing ciphertext");
  }
  try {
    if (b64decode(raw.nonce).length !== NONCE_BYTES) throw new Error();
    b64decode(raw.ciphertext);
  } catch {
    throw new MalformedEnvelopeError("Vault ciphertext encoding is invalid");
  }
  return { ...header, nonce: raw.nonce, ciphertext: raw.ciphertext };
}

async function initNew(secrets: VaultSecrets): Promise<EngineInit> {
  requireSecrets(secrets);
  await sodium.ready;

  const dataKey = sodium.randombytes_buf(DATA_KEY_BYTES);
  const salt = sodium.randombytes_buf(SALT_BYTES);
  const kdf: KdfParamsV1 = {
    algo: "argon2id",
    salt: b64encode(salt),
    time: KDF_TIME,
    mem: KDF_MEM_KIB,
    lanes: KDF_LANES,
  };
  const core = { format: VAULT_FORMAT, version: VAULT_VERSION, engine: ENGINE_ID, kdf };

  const kek = await deriveKek(secrets, kdf);
  try {
    const wrapNonce = sodium.randombytes_buf(NONCE_BYTES);
    const wrapped = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      dataKey,
      wrapAad(core),
      null,
      wrapNonce,
      kek,
    );
    const header: HeaderV1 = {
      ...core,
      wrappedDataKey: b64encode(concatBytes(wrapNonce, wrapped)),
    };
    return { header, dataKey };
  } finally {
    kek.fill(0);
  }
}

async function unlock(
  envelope: VaultEnvelope,
  secrets: VaultSecrets,
): Promise<Uint8Array> {
  requireSecrets(secrets);
  await sodium.ready;

  const env = parseEnvelopeV1(envelope);
  const wrappedAll = b64decode(env.wrappedDataKey);
  const wrapNonce = wrappedAll.subarray(0, NONCE_BYTES);
  const wrapped = wrappedAll.subarray(NONCE_BYTES);

  const kek = await deriveKek(secrets, env.kdf);
  try {
    const dataKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      wrapped,
      wrapAad(env),
      wrapNonce,
      kek,
    );
    if (dataKey === null || dataKey.length !== DATA_KEY_BYTES) {
      throw new VaultUnlockError("Wrong password or keyfile");
    }
    return dataKey;
  } catch (e) {
    if (e instanceof VaultUnlockError) throw e;
    throw new VaultUnlockError("Wrong password or keyfile");
  } finally {
    kek.fill(0);
  }
}

async function encrypt(
  header: VaultHeader,
  dataKey: Uint8Array,
  plaintext: Uint8Array,
): Promise<VaultEnvelope> {
  await sodium.ready;
  const h = parseHeaderV1(header);
  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    vaultAad(h),
    null,
    nonce,
    dataKey,
  );
  return { ...h, nonce: b64encode(nonce), ciphertext: b64encode(ciphertext) };
}

async function decrypt(
  envelope: VaultEnvelope,
  dataKey: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  const env = parseEnvelopeV1(envelope);
  try {
    const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      b64decode(env.ciphertext),
      vaultAad(env),
      b64decode(env.nonce),
      dataKey,
    );
    if (plaintext === null) throw new Error();
    return plaintext;
  } catch {
    throw new VaultDecryptError("Vault ciphertext failed authentication");
  }
}

export const argon2idXChaCha20: VaultEngineInterface = {
  id: ENGINE_ID,
  initNew,
  unlock,
  encrypt,
  decrypt,
};
