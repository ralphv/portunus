export const VAULT_FORMAT = "portunus-vault";

// Public pointer back to the app that wrote the file, written
// unencrypted into the envelope so a Drive preview shows what created it.
export const VAULT_WEBSITE = "https://github.com/ralphv/portunus";
export const VAULT_VERSION = 1;

export type VaultSecrets = {
  password: string;
  keyfile: Uint8Array;
};

// The full vault file payload. Engines extend this with their own fields
// (kdf params, wrapped data key, nonce, ciphertext), hence the index signature.
export type VaultEnvelope = {
  format: string;
  version: number;
  engine: string;
} & Record<string, unknown>;

// Envelope minus the per-save nonce/ciphertext — everything an engine needs
// to encrypt a new version of the vault.
export type VaultHeader = {
  format: string;
  version: number;
  engine: string;
} & Record<string, unknown>;

export type EngineInit = {
  header: VaultHeader;
  dataKey: Uint8Array;
};
