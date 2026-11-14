// A passkey-backed "fingerprint" check that releases a fixed 32-byte secret
// (the WebAuthn PRF extension) after user verification — fingerprint, face,
// or the device's screen lock. Fingerprint unlock (src/crypto/device-unlock.ts)
// derives the key that encrypts this device's copy of the vault data key
// from it.

export type BiometricEnrollment = {
  // b64url WebAuthn credential id and PRF salt — stored in the device record.
  credentialId: string;
  prfSalt: string;
  // The PRF output for (credential, salt). Secret: hand it to the vault
  // Worker and drop it.
  prf: Uint8Array;
};

export interface BiometricInterface {
  // Can this browser run the check with PRF at all (platform authenticator
  // or a security key)?
  isSupported(): Promise<boolean>;
  // Does the device itself have a fingerprint/face/screen-lock
  // authenticator? Gates the unprompted "set up?" offer only.
  hasPlatformAuthenticator(): Promise<boolean>;
  // Registers a passkey for this vault's keyfile id and evaluates its PRF.
  enroll(kid: string): Promise<BiometricEnrollment>;
  // Runs the check for an enrolled passkey and returns its PRF output.
  evaluate(credentialId: string, prfSalt: string): Promise<Uint8Array>;
  // Best effort: tells the passkey manager the credential is no longer used.
  forget(credentialId: string): Promise<void>;
}
