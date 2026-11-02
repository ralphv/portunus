// Test helper: a stand-in "older engine" for engine-upgrade tests. It is
// NOT secure — the data key is wrapped by XOR with SHA-256(secrets) and the
// payload is only base64 + a SHA-256 tag. What matters is that it is a
// distinct, registered engine id that unlocks, decrypts and rejects wrong
// secrets, so the upgrade path can be exercised end to end.

import { b64decode, b64encode } from "../base64";
import { VaultDecryptError, VaultUnlockError } from "../errors";
import { VAULT_FORMAT, VAULT_VERSION } from "../types";
import type { VaultEnvelope, VaultHeader, VaultSecrets } from "../types";
import type { VaultEngineInterface } from "./interface";

export const LEGACY_ENGINE_ID = "legacy-test-engine";

const te = new TextEncoder();

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", all));
}

const secretsDigest = (s: VaultSecrets) =>
  sha256(te.encode(`${s.password.length}:${s.password}`), s.keyfile);

const xor = (a: Uint8Array, b: Uint8Array) => a.map((x, i) => x ^ b[i]);

export const legacyEngine: VaultEngineInterface = {
  id: LEGACY_ENGINE_ID,
  deprecated: true,

  async initNew(secrets) {
    const dataKey = crypto.getRandomValues(new Uint8Array(32));
    const digest = await secretsDigest(secrets);
    const header: VaultHeader = {
      format: VAULT_FORMAT,
      version: VAULT_VERSION,
      engine: LEGACY_ENGINE_ID,
      check: b64encode(await sha256(te.encode("check"), digest)),
      wrapped: b64encode(xor(dataKey, digest)),
    };
    return { header, dataKey };
  },

  async unlock(envelope, secrets) {
    const digest = await secretsDigest(secrets);
    const check = b64encode(await sha256(te.encode("check"), digest));
    if (check !== envelope.check) throw new VaultUnlockError("Wrong password or keyfile");
    return xor(b64decode(envelope.wrapped as string), digest);
  },

  async encrypt(header, dataKey, plaintext): Promise<VaultEnvelope> {
    return {
      ...header,
      nonce: "",
      ciphertext: b64encode(plaintext),
      tag: b64encode(await sha256(dataKey, plaintext)),
    };
  },

  async decrypt(envelope, dataKey) {
    const plaintext = b64decode(envelope.ciphertext as string);
    if (b64encode(await sha256(dataKey, plaintext)) !== envelope.tag) {
      throw new VaultDecryptError("Vault ciphertext failed authentication");
    }
    return plaintext;
  },
};
