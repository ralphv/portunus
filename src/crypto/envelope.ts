import { MalformedEnvelopeError } from "./errors";
import { VAULT_FORMAT, VAULT_VERSION, VAULT_WEBSITE } from "./types";
import type { VaultEnvelope, VaultHeader } from "./types";

export function parseEnvelope(text: string): VaultEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new MalformedEnvelopeError("Vault file is not valid JSON");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new MalformedEnvelopeError("Vault envelope is not an object");
  }
  const env = raw as Record<string, unknown>;
  if (env.format !== VAULT_FORMAT) {
    throw new MalformedEnvelopeError("Not a portunus vault file");
  }
  if (env.version !== VAULT_VERSION) {
    throw new MalformedEnvelopeError(`Unsupported vault version: ${env.version}`);
  }
  if (typeof env.engine !== "string" || env.engine === "") {
    throw new MalformedEnvelopeError("Vault envelope has no engine id");
  }
  return env as VaultEnvelope;
}

export function serializeEnvelope(env: VaultEnvelope): string {
  // website is added at serialization (rather than baked into the header)
  // so every save writes the same canonical value, whatever the engine —
  // and it stays out of the AAD: it's discoverability metadata only.
  return JSON.stringify({ ...env, website: VAULT_WEBSITE });
}

// Header = envelope minus the per-save nonce/ciphertext.
export function headerOf(env: VaultEnvelope): VaultHeader {
  const header = { ...env };
  delete header.nonce;
  delete header.ciphertext;
  return header;
}
