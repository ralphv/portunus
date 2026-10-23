import { newEntry } from "./vault-doc";
import type {
  PasswordHistoryItem,
  VaultData,
  VaultEntry,
  VaultSettings,
} from "./vault-doc";

// The redacted vault the main thread renders. Passwords, previous passwords
// and TOTP seeds stay in the vault Worker (src/workers/vault.worker.ts); the
// UI only learns whether they exist and fetches one on demand (reveal/copy).

export type PublicHistoryItem = Omit<PasswordHistoryItem, "password">;

export type PublicEntry = Omit<
  VaultEntry,
  "password" | "passwordHistory" | "totpSecret"
> & {
  hasPassword: boolean;
  hasTotp: boolean;
  passwordHistory: PublicHistoryItem[];
};

export type PublicVaultData = {
  entries: PublicEntry[];
  settings: VaultSettings;
};

// An entry's editable secrets, held by the Worker per entry id.
export type EntrySecrets = {
  password: string;
  totpSecret?: string;
};

export function toPublicEntry(entry: VaultEntry): PublicEntry {
  const { password, totpSecret, passwordHistory, ...rest } = entry;
  return {
    ...rest,
    hasPassword: password !== "",
    hasTotp: Boolean(totpSecret),
    passwordHistory: passwordHistory.map((h) => ({ replacedAt: h.replacedAt })),
  };
}

export function toPublic(data: VaultData): PublicVaultData {
  return { entries: data.entries.map(toPublicEntry), settings: data.settings };
}

// Inverse of toPublicEntry, inside the Worker: re-attaches the secrets.
export function withSecrets(
  entry: PublicEntry,
  secrets: EntrySecrets | undefined,
  history: PasswordHistoryItem[],
): VaultEntry {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { hasPassword, hasTotp, passwordHistory, ...rest } = entry;
  return {
    ...rest,
    password: secrets?.password ?? "",
    totpSecret: secrets?.totpSecret || undefined,
    passwordHistory: history,
  };
}

export function newPublicEntry(now: Date = new Date()): PublicEntry {
  return toPublicEntry(newEntry(now));
}
