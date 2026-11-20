import { z } from "zod";

// An Argon2id KDF cost env value (PORTUNUS_KDF_TIME, PORTUNUS_KDF_MEM_MIB):
// a whole number within the given inclusive range. The bounds come from the
// caller (constants) so this stays a generic integer-range check.
export const kdfParamSchema = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

export type KdfParam = z.infer<ReturnType<typeof kdfParamSchema>>;
