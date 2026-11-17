import { z } from "zod";

import { LOCK_SECONDS_MAX } from "@/constants";

// A lock-timing env value (PORTUNUS_AUTO_LOCK_SECONDS,
// PORTUNUS_HIDDEN_LOCK_SECONDS): a whole number of seconds from `min` up to
// LOCK_SECONDS_MAX.
export const lockSecondsSchema = (min: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(LOCK_SECONDS_MAX));

export type LockSeconds = z.infer<ReturnType<typeof lockSecondsSchema>>;
