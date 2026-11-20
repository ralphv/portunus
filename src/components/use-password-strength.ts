"use client";

import { useEffect, useState } from "react";

import { checkPasswordStrength } from "@/lib/password-strength";
import type { PasswordStrength } from "@/lib/password-strength";

// Debounced, client-side strength scoring for the master password. Unlike
// entry passwords (scored in the vault Worker, where their plaintext lives),
// the master password at create / change time is on the main thread before
// any Worker exists, so it is scored here with zxcvbn (lazy-loaded). Stays
// client-side — the master password never leaves the device.
//
// `userInputs` (e.g. the account email) are penalised by zxcvbn; they are
// joined into a stable dependency so a new array each render doesn't rescore.
export function usePasswordStrength(
  password: string,
  userInputs: string[] = [],
  debounceMs = 250,
): { strength: PasswordStrength | null; checking: boolean } {
  // The score and the exact password it was computed for, so a stale or
  // empty password derives to `null` without a synchronous setState.
  const [scored, setScored] = useState<{
    password: string;
    value: PasswordStrength | null;
  } | null>(null);
  const inputsKey = userInputs.join("\u0000");

  useEffect(() => {
    if (!password) return;
    let cancelled = false;
    const inputs = inputsKey ? inputsKey.split("\u0000") : [];
    const timer = setTimeout(() => {
      void checkPasswordStrength(password, inputs).then(
        (value) => {
          if (!cancelled) setScored({ password, value });
        },
        () => {
          // Scoring failed (e.g. offline chunk load) — record it so the UI
          // stops showing "scoring…" rather than hanging.
          if (!cancelled) setScored({ password, value: null });
        },
      );
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [password, inputsKey, debounceMs]);

  const current = scored && scored.password === password;
  return {
    strength: current ? scored.value : null,
    checking: Boolean(password) && !current,
  };
}
