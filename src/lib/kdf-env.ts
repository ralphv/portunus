import {
  KDF_MEM_MIB_DEFAULT,
  KDF_MEM_MIB_ENV,
  KDF_MEM_MIB_MAX,
  KDF_MEM_MIB_MIN,
  KDF_TIME_DEFAULT,
  KDF_TIME_ENV,
  KDF_TIME_MAX,
  KDF_TIME_MIN,
  LOG_KDF_PARAM_INVALID,
} from "@/constants";
import type { KdfTarget } from "@/crypto";
import { createSchemaValidatorFactory } from "@/factory";
import { kdfParamSchema } from "@/lib/schemas/kdf-param.schema";

// Server-side read of the Argon2id cost env vars, passed to the client as a
// prop (like LockConfig) and from there into the vault Worker, which uses it
// as the target cost for newly written wraps. `mem` is in KiB to match the
// engine and the stored envelope; the env var is given in MiB for operators.

// Unset or blank → the default; an invalid value is logged (by name only)
// and also falls back to the default.
function readParam(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const result = createSchemaValidatorFactory().check(
    kdfParamSchema(min, max),
    raw,
  );
  if (result.ok) return result.value;
  console.warn(LOG_KDF_PARAM_INVALID, name);
  return fallback;
}

// The server's own env is read once, so an invalid value is logged once,
// not on every page request.
let fromProcessEnv: KdfTarget | undefined;

export function kdfConfig(
  env: Record<string, string | undefined> = process.env,
): KdfTarget {
  if (env === process.env) return (fromProcessEnv ??= readKdfConfig(env));
  return readKdfConfig(env);
}

function readKdfConfig(env: Record<string, string | undefined>): KdfTarget {
  const time = readParam(
    env,
    KDF_TIME_ENV,
    KDF_TIME_DEFAULT,
    KDF_TIME_MIN,
    KDF_TIME_MAX,
  );
  const memMib = readParam(
    env,
    KDF_MEM_MIB_ENV,
    KDF_MEM_MIB_DEFAULT,
    KDF_MEM_MIB_MIN,
    KDF_MEM_MIB_MAX,
  );
  return { time, mem: memMib * 1024 };
}
