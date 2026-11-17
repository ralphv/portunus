import {
  AUTO_LOCK_SECONDS_DEFAULT,
  AUTO_LOCK_SECONDS_ENV,
  AUTO_LOCK_SECONDS_MIN,
  HIDDEN_LOCK_SECONDS_DEFAULT,
  HIDDEN_LOCK_SECONDS_ENV,
  HIDDEN_LOCK_SECONDS_MIN,
  LOG_LOCK_SECONDS_INVALID,
} from "@/constants";
import { createSchemaValidatorFactory } from "@/factory";
import { lockSecondsSchema } from "@/lib/schemas/lock-seconds.schema";

// Server-side reads of the lock-timing env vars, passed to the client as
// props (like PORTUNUS_HIBP_ON_EDIT).

export type LockConfig = {
  // PORTUNUS_AUTO_LOCK_SECONDS — idle time before the vault locks.
  autoLockSeconds: number;
  // PORTUNUS_HIDDEN_LOCK_SECONDS — how long the page may stay hidden
  // (blurred) before the vault locks.
  hiddenLockSeconds: number;
};

// Unset or blank → the default; an invalid value is logged (by name only)
// and also falls back to the default.
function readSeconds(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  min: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const result = createSchemaValidatorFactory().check(lockSecondsSchema(min), raw);
  if (result.ok) return result.value;
  console.warn(LOG_LOCK_SECONDS_INVALID, name);
  return fallback;
}

export function lockConfig(
  env: Record<string, string | undefined> = process.env,
): LockConfig {
  return {
    autoLockSeconds: readSeconds(
      env,
      AUTO_LOCK_SECONDS_ENV,
      AUTO_LOCK_SECONDS_DEFAULT,
      AUTO_LOCK_SECONDS_MIN,
    ),
    hiddenLockSeconds: readSeconds(
      env,
      HIDDEN_LOCK_SECONDS_ENV,
      HIDDEN_LOCK_SECONDS_DEFAULT,
      HIDDEN_LOCK_SECONDS_MIN,
    ),
  };
}
