import { z } from "zod";

import { HIDDEN_LOCK_SECONDS_MAX } from "@/constants";

// PORTUNUS_HIDDEN_LOCK_SECONDS: a whole number of seconds, 0 (lock as soon
// as the page is hidden) up to HIDDEN_LOCK_SECONDS_MAX.
export const hiddenLockSecondsSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(0).max(HIDDEN_LOCK_SECONDS_MAX));

export type HiddenLockSeconds = z.infer<typeof hiddenLockSecondsSchema>;
