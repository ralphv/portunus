import type { Keyfile, VaultSecrets } from "@/crypto";
import { VaultError } from "@/crypto/errors";

import { generatePassword } from "./password-gen";
import { checkPasswordStrength } from "./password-strength";
import type { PasswordStrength } from "./password-strength";
import { checkPasswordPwned } from "./pwned-passwords";
import type { PwnedCheckResult } from "./pwned-passwords";
import { generateTotp, parseTotp } from "./totp";
import {
  emptyVaultData,
  parseVaultData,
  prepareVaultForSave,
  serializeVaultData,
} from "./vault-doc";
import type { VaultData } from "./vault-doc";
import { toPublic, withSecrets } from "./vault-public";
import type { EntrySecrets, PublicVaultData } from "./vault-public";
import type { CachedVault, RemoteVault } from "./vault-remote";
import { VaultSession } from "./vault-session";

// Everything that touches key material or plaintext secrets, run inside the
// vault Worker. The main thread holds the redacted PublicVaultData and asks
// for a secret only for an explicit action (reveal, copy, edit). A script
// running in the page can still send these requests — this keeps secrets
// out of main-thread memory and DOM snapshots, the CSP keeps such script out.

export type SecretRef =
  | { field: "password" }
  | { field: "totp" }
  | { field: "history"; index: number; replacedAt: string };

export type TotpView = {
  code: string;
  digits: number;
  period: number;
  // Index of the period the code belongs to (floor(time / period)).
  counter: number;
};

export type SavedVault = {
  data: PublicVaultData;
  // For the main thread's offline ciphertext cache.
  cache: CachedVault;
};

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class VaultWorkerCore {
  private session: VaultSession | null = null;
  // Last loaded/saved document, including secrets and password history.
  private saved: VaultData = emptyVaultData();
  // Current (draft) secrets per entry id; everything else in the draft is
  // public and comes from the main thread at save time.
  private secrets = new Map<string, EntrySecrets>();
  private strengthCache = new Map<string, PasswordStrength>();

  private get current(): VaultSession {
    if (!this.session) throw new VaultError("Vault is locked");
    return this.session;
  }

  private load(session: VaultSession, data: VaultData): void {
    this.session = session;
    this.saved = data;
    this.secrets = new Map(
      data.entries.map((e) => [
        e.id,
        { password: e.password, totpSecret: e.totpSecret },
      ]),
    );
  }

  async open(
    remote: RemoteVault,
    secrets: VaultSecrets,
  ): Promise<{ data: PublicVaultData; offline: boolean }> {
    const session = await VaultSession.fromRemote(remote, secrets);
    const data = parseVaultData(session.data);
    this.load(session, data);
    return { data: toPublic(data), offline: session.offline };
  }

  async create(secrets: VaultSecrets): Promise<SavedVault> {
    const data = emptyVaultData();
    const session = await VaultSession.create(secrets, serializeVaultData(data));
    this.load(session, data);
    return { data: toPublic(data), cache: session.cacheEntry };
  }

  setSecret(
    id: string,
    field: "password" | "totp",
    value: string | undefined,
  ): void {
    const cur = this.secrets.get(id) ?? { password: "" };
    this.secrets.set(
      id,
      field === "password"
        ? { ...cur, password: value ?? "" }
        : { ...cur, totpSecret: value || undefined },
    );
  }

  generatePassword(id: string): void {
    this.setSecret(id, "password", generatePassword());
  }

  reveal(id: string, ref: SecretRef): string {
    if (ref.field === "history") {
      const history =
        this.saved.entries.find((e) => e.id === id)?.passwordHistory ?? [];
      const item =
        history[ref.index]?.replacedAt === ref.replacedAt
          ? history[ref.index]
          : history.find((h) => h.replacedAt === ref.replacedAt);
      return item?.password ?? "";
    }
    const s = this.secrets.get(id);
    return (ref.field === "password" ? s?.password : s?.totpSecret) ?? "";
  }

  // Ids of saved entries whose password differs from the saved copy.
  passwordPending(): string[] {
    return this.saved.entries
      .filter((e) => {
        const s = this.secrets.get(e.id);
        return s !== undefined && s.password !== e.password;
      })
      .map((e) => e.id);
  }

  async strengths(
    ids: string[],
  ): Promise<Record<string, PasswordStrength | null>> {
    const out: Record<string, PasswordStrength | null> = {};
    for (const id of ids) {
      const pw = this.secrets.get(id)?.password;
      if (!pw) {
        out[id] = null;
        continue;
      }
      let s = this.strengthCache.get(pw);
      if (!s) {
        // zxcvbn takes ~15–25ms per password and the Worker answers one
        // message at a time: yield before each one so queued requests
        // (reveal, copy, TOTP, save) aren't stuck behind a whole vault.
        await yieldToEventLoop();
        s = await checkPasswordStrength(pw);
        this.strengthCache.set(pw, s);
      }
      out[id] = s;
    }
    return out;
  }

  // Null when there's no password or it changed while the request ran.
  async checkPwned(id: string): Promise<PwnedCheckResult | null> {
    const pw = this.secrets.get(id)?.password;
    if (!pw) return null;
    const result = await checkPasswordPwned(pw);
    return this.secrets.get(id)?.password === pw ? result : null;
  }

  // Groups `ids` by shared password (empty ones dropped), so the audit
  // checks each distinct password once.
  auditGroups(ids: string[]): string[][] {
    const groups = new Map<string, string[]>();
    for (const id of ids) {
      const pw = this.secrets.get(id)?.password;
      if (!pw) continue;
      const g = groups.get(pw);
      if (g) g.push(id);
      else groups.set(pw, [id]);
    }
    return [...groups.values()];
  }

  // Checks the password `ids[0]` holds; returns every entry holding it now.
  async checkPwnedGroup(
    ids: string[],
  ): Promise<{ result: PwnedCheckResult; ids: string[] } | null> {
    const pw = ids.length ? this.secrets.get(ids[0])?.password : undefined;
    if (!pw) return null;
    const result = await checkPasswordPwned(pw);
    const holders = [...this.secrets]
      .filter(([, s]) => s.password === pw)
      .map(([id]) => id);
    return { result, ids: holders };
  }

  async totp(id: string, timeMs: number = Date.now()): Promise<TotpView | null> {
    const uri = this.secrets.get(id)?.totpSecret;
    const params = uri ? parseTotp(uri) : null;
    if (!params) return null;
    return {
      code: await generateTotp(params, timeMs),
      digits: params.digits,
      period: params.period,
      counter: Math.floor(timeMs / 1000 / params.period),
    };
  }

  async verifyPassword(password: string): Promise<void> {
    await this.current.verifyPassword(password);
  }

  // Re-attaches the secrets to the main thread's draft and applies the
  // save-time password metadata against the saved copy.
  private finalize(draft: PublicVaultData, now: Date): VaultData {
    const savedById = new Map(this.saved.entries.map((e) => [e.id, e]));
    const full: VaultData = {
      settings: draft.settings,
      entries: draft.entries.map((e) =>
        withSecrets(
          e,
          this.secrets.get(e.id),
          savedById.get(e.id)?.passwordHistory ?? [],
        ),
      ),
    };
    return prepareVaultForSave(this.saved, full, now);
  }

  async save(
    draft: PublicVaultData,
    nowMs: number = Date.now(),
  ): Promise<SavedVault> {
    const session = this.current;
    const finalized = this.finalize(draft, new Date(nowMs));
    session.update(serializeVaultData(finalized));
    await session.save();
    this.saved = finalized;
    return { data: toPublic(finalized), cache: session.cacheEntry };
  }

  async changePassword(
    newPassword: string,
    draft: PublicVaultData,
    nowMs: number = Date.now(),
  ): Promise<SavedVault> {
    const session = this.current;
    const finalized = this.finalize(draft, new Date(nowMs));
    session.update(serializeVaultData(finalized));
    await session.changePassword(newPassword);
    this.saved = finalized;
    return { data: toPublic(finalized), cache: session.cacheEntry };
  }

  async exportKeyfile(): Promise<Keyfile> {
    return this.current.exportKeyfile();
  }

  // See VaultSession.reconnect: true = remote changed, stay read-only.
  reconnect(remote: RemoteVault): boolean {
    return this.current.reconnect(remote);
  }
}
