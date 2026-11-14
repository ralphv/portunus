import type { BiometricInterface } from "./biometric-interface";
import { NopBiometricProvider } from "./providers/nop-biometric-provider";
import { WebAuthnPrfBiometricProvider } from "./providers/webauthn-prf-biometric-provider";

// Both providers are stateless: a fresh instance per call. `enabled` is the
// PORTUNUS_BIOMETRIC_UNLOCK flag, resolved on the server; off (or no
// WebAuthn in this browser) gets the NOP provider.
export function createBiometricFactory(enabled: boolean): BiometricInterface {
  return enabled && typeof PublicKeyCredential !== "undefined"
    ? new WebAuthnPrfBiometricProvider()
    : new NopBiometricProvider();
}
