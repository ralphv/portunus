import { BiometricError } from "../biometric-error";
import type { BiometricEnrollment, BiometricInterface } from "../biometric-interface";

// Fingerprint unlock off (PORTUNUS_BIOMETRIC_UNLOCK unset) or no WebAuthn:
// nothing is supported and every check fails as unsupported.
export class NopBiometricProvider implements BiometricInterface {
  async isSupported(): Promise<boolean> {
    return false;
  }

  async hasPlatformAuthenticator(): Promise<boolean> {
    return false;
  }

  async enroll(): Promise<BiometricEnrollment> {
    throw new BiometricError("unsupported");
  }

  async evaluate(): Promise<Uint8Array> {
    throw new BiometricError("unsupported");
  }

  async forget(): Promise<void> {}
}
