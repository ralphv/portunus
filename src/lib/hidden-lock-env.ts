import {
  HIDDEN_LOCK_SECONDS_DEFAULT,
  HIDDEN_LOCK_SECONDS_ENV,
  LOG_HIDDEN_LOCK_SECONDS_INVALID,
} from "@/constants";
import { createSchemaValidatorFactory } from "@/factory";
import { hiddenLockSecondsSchema } from "@/lib/schemas/hidden-lock-seconds.schema";

// Server-side read of PORTUNUS_HIDDEN_LOCK_SECONDS, passed to the client as
// a prop (like PORTUNUS_HIBP_ON_EDIT): how long the page may stay hidden
// before the vault locks. Unset or blank → the default; an invalid value
// is logged and also falls back to the default.
export function hiddenLockSeconds(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[HIDDEN_LOCK_SECONDS_ENV];
  if (raw === undefined || raw.trim() === "") return HIDDEN_LOCK_SECONDS_DEFAULT;
  const result = createSchemaValidatorFactory().check(hiddenLockSecondsSchema, raw);
  if (result.ok) return result.value;
  console.warn(LOG_HIDDEN_LOCK_SECONDS_INVALID);
  return HIDDEN_LOCK_SECONDS_DEFAULT;
}
