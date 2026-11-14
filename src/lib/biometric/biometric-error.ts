import {
  BIOMETRIC_CANCELLED_MESSAGE,
  BIOMETRIC_FAILED_MESSAGE,
  BIOMETRIC_UNSUPPORTED_MESSAGE,
} from "@/constants";

export type BiometricErrorKind = "unsupported" | "cancelled" | "failed";

const MESSAGES: Record<BiometricErrorKind, string> = {
  unsupported: BIOMETRIC_UNSUPPORTED_MESSAGE,
  cancelled: BIOMETRIC_CANCELLED_MESSAGE,
  failed: BIOMETRIC_FAILED_MESSAGE,
};

// A fingerprint check that didn't produce a secret. Never says more than
// the kind: a refused check and a cancelled one look the same to WebAuthn.
export class BiometricError extends Error {
  constructor(readonly kind: BiometricErrorKind) {
    super(MESSAGES[kind]);
    this.name = new.target.name;
  }
}
