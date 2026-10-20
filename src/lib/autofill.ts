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

// The vault's "password fill & save" preference, mirrored to localStorage
// by the unlocked vault so the unlock screen — rendered before the vault
// can be read — honors it. Scoped per vault by keyfile id: localStorage is
// per-origin, so an unscoped key would leak one account's preference onto
// another account's unlock screen on a shared device. Absent or unreadable
// → default off.
function keyFor(kid: string): string {
  return `${PASSWORD_FILL_SAVE_KEY}.${kid}`;
}

export function readPasswordFillSave(kid: string): boolean {
  try {
    return localStorage.getItem(keyFor(kid)) === "1";
  } catch {
    // Storage unavailable (SSR, disabled cookies/storage) — treat as off.
    return false;
  }
}

export function writePasswordFillSave(kid: string, allowed: boolean): void {
  try {
    localStorage.setItem(keyFor(kid), allowed ? "1" : "0");
  } catch {
    // Quota errors are non-fatal — this is a best-effort mirror.
  }
}
