export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

// Envelope JSON is structurally invalid (bad types, missing fields, bad base64).
export class MalformedEnvelopeError extends VaultError {}

// envelope.engine has no registered engine.
export class UnsupportedEngineError extends VaultError {}

// Data-key unwrap failed: wrong password, wrong keyfile, or tampered header.
export class VaultUnlockError extends VaultError {}

// Vault ciphertext failed AEAD verification or did not decrypt.
export class VaultDecryptError extends VaultError {}

// Keyfile text is not a valid portunus.key document.
export class InvalidKeyfileError extends VaultError {}
