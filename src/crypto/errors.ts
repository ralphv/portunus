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

// Fingerprint (device) unlock failed: wrong passkey secret, tampered record,
// or a record for another keyfile. Deliberately unspecific.
export class DeviceUnlockError extends VaultError {}

// The device's record was made for an older vault header (the master
// password or the encryption engine changed since): it can never work again
// and should be deleted and re-enrolled.
export class DeviceUnlockStaleError extends DeviceUnlockError {}

// A save needs the master password (it re-wraps the vault under a newer
// engine) but was confirmed some other way, e.g. by biometrics.
export class PasswordRequiredError extends VaultError {}
