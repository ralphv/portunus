import type {
  EngineInit,
  VaultEnvelope,
  VaultHeader,
  VaultSecrets,
} from "../types";

// A vault crypto engine. Implementations are stateless singletons registered
// in the engine registry; callers hold the returned header + data key.
//
// Deprecated engines must remain registered forever (unlock/decrypt only) —
// removing one bricks vaults written with it.
export interface VaultEngineInterface {
  readonly id: string;
  readonly deprecated?: boolean;

  // Create a fresh vault: generates a data key, wraps it under the KEK
  // derived from `secrets`, and returns the header + the raw data key.
  initNew(secrets: VaultSecrets): Promise<EngineInit>;

  // Unwrap the data key using `secrets`. Only header fields are read, so a
  // VaultHeader (e.g. headerOf(envelope)) is sufficient — this also powers
  // password re-verification before saves.
  // Throws VaultUnlockError on wrong credentials or tampered header.
  unlock(envelope: VaultHeader, secrets: VaultSecrets): Promise<Uint8Array>;

  // Encrypt vault plaintext under `dataKey`, producing a complete envelope
  // (header fields + fresh nonce + ciphertext). Header fields are bound as AAD.
  encrypt(
    header: VaultHeader,
    dataKey: Uint8Array,
    plaintext: Uint8Array,
  ): Promise<VaultEnvelope>;

  // Decrypt an envelope's ciphertext with a previously unwrapped data key.
  // Throws VaultDecryptError on tampered ciphertext/nonce/header.
  decrypt(envelope: VaultEnvelope, dataKey: Uint8Array): Promise<Uint8Array>;
}
