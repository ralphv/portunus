import { LOG_BIOMETRIC_FAILED } from "@/constants";

import { BiometricError } from "./biometric-error";

// Puts what went wrong with a biometric check in the browser console, for
// diagnosing an authenticator: the WebAuthn step and the browser's error,
// or the error class and message for anything else. Never key material.
// console.warn, not .error: a refused check is an expected outcome.
export function logBiometricFailure(err: unknown): void {
  const what =
    err instanceof BiometricError
      ? `${err.kind}${err.detail ? ` (${err.detail})` : ""}`
      : err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err);
  console.warn(LOG_BIOMETRIC_FAILED, what);
}
