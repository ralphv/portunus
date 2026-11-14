import {
  BIOMETRIC_SAVE_CONFIRM_ENV,
  BIOMETRIC_SAVE_CONFIRM_ENV_OFF,
  BIOMETRIC_UNLOCK_ENV,
  BIOMETRIC_UNLOCK_ENV_ON,
} from "@/constants";

// Server-side reads of the biometric-unlock env flags, passed to the client
// as props (like PORTUNUS_HIBP_ON_EDIT).

export type BiometricConfig = {
  // PORTUNUS_BIOMETRIC_UNLOCK=1 — off unless set.
  unlock: boolean;
  // PORTUNUS_BIOMETRIC_SAVE_CONFIRM=0 turns it off; on by default. Only
  // matters while `unlock` is on.
  saveConfirm: boolean;
};

export function biometricConfig(
  env: Record<string, string | undefined> = process.env,
): BiometricConfig {
  const unlock = env[BIOMETRIC_UNLOCK_ENV] === BIOMETRIC_UNLOCK_ENV_ON;
  return {
    unlock,
    saveConfirm: unlock && env[BIOMETRIC_SAVE_CONFIRM_ENV] !== BIOMETRIC_SAVE_CONFIRM_ENV_OFF,
  };
}
