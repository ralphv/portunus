// Attributes that suppress browser/OS password-manager autofill and save
// prompts on Portunus's own password inputs. `autoComplete="off"`
// alone only covers built-in managers; the data-* flags are honored by
// 1Password, LastPass, Bitwarden, and Dashlane.
//
// Caveat: iOS Safari's "Passwords" keyboard suggestion keys off
// type="password" itself and can't be fully suppressed declaratively —
// this removes most of the noise, not all of it on iOS.
import { PASSWORD_FILL_SAVE_KEY } from "@/constants";

export const PASSWORD_AUTOFILL_OFF = {
  autoComplete: "off",
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-bwignore": true,
  "data-form-type": "other",
} as const;

// The user's last-known "password fill & save" preference, mirrored to
// localStorage by the unlocked vault so screens that render before the
// vault is loaded (unlock, create) can honor it. Absent → default off.
export function readPasswordFillSave(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(PASSWORD_FILL_SAVE_KEY) === "1";
}

export function writePasswordFillSave(allowed: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PASSWORD_FILL_SAVE_KEY, allowed ? "1" : "0");
  } catch {
    // Quota errors are non-fatal — this is a best-effort mirror.
  }
}
