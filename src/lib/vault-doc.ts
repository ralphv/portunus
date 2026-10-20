import { VaultError, VAULT_WEBSITE } from "@/crypto";

// The decrypted vault payload — the JSON document inside the ciphertext.
// Never leaves the client unencrypted.

export const VAULT_DATA_FORMAT = "portunus-vault-data";
export const VAULT_DATA_VERSION = 1;

export const PASSWORD_HISTORY_LIMIT = 5;

export type PasswordHistoryItem = {
  password: string;
  replacedAt: string; // ISO 8601
};

// Result of a Have I Been Pwned range check against the entry's password.
// `checkedAt` is when it ran, `count` is the breach count seen.
export type PwnedCheck = {
  checkedAt: string; // ISO 8601
  pwned: boolean;
  count: number;
};

// Label applied to entries whose password was found in breaches; it flows
// through the normal label machinery (chips, filters) like any other label.
export const PWNED_LABEL = "pwned";

export type VaultEntry = {
  id: string;
  name: string;
  username: string;
  email: string;
  password: string;
  url: string;
  notes: string;
  labels: string[];
  updatedAt: string; // ISO 8601
  createdAt: string; // ISO 8601
  passwordUpdatedAt: string; // ISO 8601
  passwordUpdateCount: number;
  // Prior passwords, newest first, capped at PASSWORD_HISTORY_LIMIT.
  passwordHistory: PasswordHistoryItem[];
  // Latest Pwned Passwords check for the current password; cleared whenever
  // the password changes. Absent when never checked or a check failed.
  pwnedCheck?: PwnedCheck;
  // TOTP secret as a canonical otpauth://totp/… URI (see lib/totp.ts).
  // Absent when the entry has no two-factor code configured.
  totpSecret?: string;
};

// Per-vault user preferences — synced inside the encrypted document, so
// they follow the vault across devices. Non-secret by design: keep only
// things that are safe to toggle while unlocked.
export type VaultSettings = {
  // Silent Have I Been Pwned re-check when an entry's password is edited.
  checkPwnedOnEdit: boolean;
  // Let the browser/OS offer to fill and save passwords in Portunus
  // fields. Off by default: our password inputs suppress the prompts.
  allowPasswordFillSave: boolean;
};

export function defaultVaultSettings(): VaultSettings {
  return { checkPwnedOnEdit: true, allowPasswordFillSave: false };
}

export type VaultData = {
  entries: VaultEntry[];
  settings: VaultSettings;
};

const te = new TextEncoder();
const td = new TextDecoder();

export function emptyVaultData(): VaultData {
  return { entries: [], settings: defaultVaultSettings() };
}

export function newEntry(now: Date = new Date()): VaultEntry {
  const ts = now.toISOString();
  return {
    id: crypto.randomUUID(),
    name: "",
    username: "",
    email: "",
    password: "",
    url: "",
    notes: "",
    labels: [],
    updatedAt: ts,
    createdAt: ts,
    passwordUpdatedAt: ts,
    passwordUpdateCount: 0,
    passwordHistory: [],
    pwnedCheck: undefined,
    totpSecret: undefined,
  };
}

export function serializeVaultData(data: VaultData): Uint8Array {
  return te.encode(
    JSON.stringify({
      format: VAULT_DATA_FORMAT,
      version: VAULT_DATA_VERSION,
      website: VAULT_WEBSITE,
      entries: data.entries,
      settings: data.settings,
    }),
  );
}

const EPOCH_ISO = new Date(0).toISOString();

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Valid timestamp → canonical ISO string; anything else → null.
function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Trimmed, non-empty, de-duplicated (case-insensitive, first spelling wins).
export function normalizeLabels(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const label = item.trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

// Missing or malformed settings fall back per-key to the defaults, so a
// doc written by an older/newer version still parses.
function normalizeSettings(v: unknown): VaultSettings {
  const s =
    v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    checkPwnedOnEdit:
      typeof s.checkPwnedOnEdit === "boolean"
        ? s.checkPwnedOnEdit
        : true,
    allowPasswordFillSave:
      typeof s.allowPasswordFillSave === "boolean"
        ? s.allowPasswordFillSave
        : false,
  };
}

function normalizePwnedCheck(v: unknown): PwnedCheck | undefined {
  if (v === null || typeof v !== "object") return undefined;
  const c = v as Record<string, unknown>;
  const checkedAt = isoOrNull(c.checkedAt);
  if (!checkedAt || typeof c.pwned !== "boolean") return undefined;
  if (
    typeof c.count !== "number" ||
    !Number.isInteger(c.count) ||
    c.count < 0
  ) {
    return undefined;
  }
  return { checkedAt, pwned: c.pwned, count: c.count };
}

function normalizeHistory(v: unknown, fallbackTs: string): PasswordHistoryItem[] {
  if (!Array.isArray(v)) return [];
  const out: PasswordHistoryItem[] = [];
  for (const item of v) {
    if (out.length >= PASSWORD_HISTORY_LIMIT) break;
    if (item === null || typeof item !== "object") continue;
    const h = item as Record<string, unknown>;
    if (typeof h.password !== "string" || !h.password) continue;
    out.push({
      password: h.password,
      replacedAt: isoOrNull(h.replacedAt) ?? fallbackTs,
    });
  }
  return out;
}

function normalizeEntry(raw: unknown): VaultEntry {
  const e =
    raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  // Legacy entries (pre-metadata) only carry updatedAt — the best available
  // stand-in for when they were created / last had their password set.
  const updatedAt = isoOrNull(e.updatedAt) ?? EPOCH_ISO;
  const createdAt = isoOrNull(e.createdAt) ?? updatedAt;
  const passwordUpdatedAt = isoOrNull(e.passwordUpdatedAt) ?? updatedAt;
  const count = e.passwordUpdateCount;
  return {
    id: typeof e.id === "string" && e.id ? e.id : crypto.randomUUID(),
    name: str(e.name),
    username: str(e.username),
    email: str(e.email),
    password: str(e.password),
    url: str(e.url),
    notes: str(e.notes),
    labels: normalizeLabels(e.labels),
    updatedAt,
    createdAt,
    passwordUpdatedAt,
    passwordUpdateCount:
      typeof count === "number" && Number.isFinite(count) && count > 0
        ? Math.floor(count)
        : 0,
    passwordHistory: normalizeHistory(e.passwordHistory, passwordUpdatedAt),
    pwnedCheck: normalizePwnedCheck(e.pwnedCheck),
    // Kept opaque here (it's validated again on parse/generate); anything
    // non-string is dropped rather than preserved as junk.
    totpSecret: typeof e.totpSecret === "string" && e.totpSecret
      ? e.totpSecret
      : undefined,
  };
}

export function parseVaultData(bytes: Uint8Array): VaultData {
  let raw: unknown;
  try {
    raw = JSON.parse(td.decode(bytes));
  } catch {
    throw new VaultError("Vault contents are not valid JSON");
  }
  const obj = raw as Record<string, unknown> | null;
  if (
    obj === null ||
    typeof obj !== "object" ||
    obj.format !== VAULT_DATA_FORMAT ||
    obj.version !== VAULT_DATA_VERSION ||
    !Array.isArray(obj.entries)
  ) {
    throw new VaultError("Vault contents are not a portunus vault");
  }
  return {
    entries: obj.entries.map(normalizeEntry),
    settings: normalizeSettings(obj.settings),
  };
}

// Applies password metadata to a draft entry at save time, relative to the
// last-saved copy. Metadata is derived from the baseline (not the draft), so
// re-running after a failed save gives the same history/count.
export function finalizeEntryForSave(
  baseline: VaultEntry | undefined,
  draft: VaultEntry,
  now: Date = new Date(),
): VaultEntry {
  const ts = now.toISOString();
  // First save of a new entry: the password is "set" now, not when the
  // empty entry was added — but it's an initial value, not an update.
  if (!baseline) {
    return draft.password ? { ...draft, passwordUpdatedAt: ts } : draft;
  }
  if (baseline.password === draft.password) return draft;
  const history = baseline.password
    ? [{ password: baseline.password, replacedAt: ts }, ...baseline.passwordHistory]
    : baseline.passwordHistory;
  return {
    ...draft,
    passwordUpdatedAt: ts,
    passwordUpdateCount: baseline.passwordUpdateCount + 1,
    passwordHistory: history.slice(0, PASSWORD_HISTORY_LIMIT),
  };
}

// Matches draft entries to baseline entries by id. Added entries pass
// through; deleted ones simply aren't in the draft.
export function prepareVaultForSave(
  baseline: VaultData,
  draft: VaultData,
  now: Date = new Date(),
): VaultData {
  const byId = new Map(baseline.entries.map((e) => [e.id, e]));
  return {
    entries: draft.entries.map((e) => finalizeEntryForSave(byId.get(e.id), e, now)),
    settings: draft.settings,
  };
}

export type DraftSessionInterface = {
  readonly dirty: boolean;
  update(plaintext: Uint8Array): void;
};

// Save path shared by "Save" and master-password change: finalize the draft
// against the last-saved snapshot, hand it to the session, then persist.
// Returns the document that is now saved — the caller's new baseline.
// Throws (leaving the caller's baseline untouched) if persist fails.
export async function saveVaultDraft(
  session: DraftSessionInterface,
  baseline: VaultData,
  draft: VaultData,
  persist: () => Promise<void>,
  now: Date = new Date(),
): Promise<VaultData> {
  if (!session.dirty) {
    await persist();
    return draft;
  }
  const finalized = prepareVaultForSave(baseline, draft, now);
  session.update(serializeVaultData(finalized));
  await persist();
  return finalized;
}

// Applies a Pwned Passwords result to an entry: stores the metadata and
// keeps the `pwned` label in sync (added when breached, removed when clean
// or cleared). Pass `undefined` to clear the state entirely (e.g. the
// password changed).
export function applyPwnedCheck(
  entry: VaultEntry,
  check: PwnedCheck | undefined,
): VaultEntry {
  const hasLabel = entry.labels.some(
    (l) => l.toLowerCase() === PWNED_LABEL,
  );
  if (!check) {
    if (entry.pwnedCheck === undefined && !hasLabel) return entry;
    return {
      ...entry,
      pwnedCheck: undefined,
      labels: hasLabel
        ? entry.labels.filter((l) => l.toLowerCase() !== PWNED_LABEL)
        : entry.labels,
    };
  }
  const labels =
    check.pwned && !hasLabel
      ? normalizeLabels([...entry.labels, PWNED_LABEL])
      : !check.pwned && hasLabel
        ? entry.labels.filter((l) => l.toLowerCase() !== PWNED_LABEL)
        : entry.labels;
  return { ...entry, pwnedCheck: check, labels };
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function addMonthsUTC(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      y,
      m,
      Math.min(d.getUTCDate(), lastDay),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Human elapsed time using the two largest calendar units, e.g. "3 days",
// "2 months and 4 days", "1 year and 2 months".
export function formatElapsed(from: string | Date, to: Date = new Date()): string {
  const start = typeof from === "string" ? new Date(from) : from;
  if (Number.isNaN(start.getTime()) || Number.isNaN(to.getTime())) return "unknown";
  const ms = to.getTime() - start.getTime();
  if (ms < MINUTE_MS) return "less than a minute";
  if (ms < HOUR_MS) return plural(Math.floor(ms / MINUTE_MS), "minute");
  if (ms < DAY_MS) return plural(Math.floor(ms / HOUR_MS), "hour");

  let months =
    (to.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - start.getUTCMonth());
  if (addMonthsUTC(start, months).getTime() > to.getTime()) months -= 1;
  months = Math.max(0, months);
  const days = Math.floor(
    (to.getTime() - addMonthsUTC(start, months).getTime()) / DAY_MS,
  );

  if (months >= 12) {
    const years = Math.floor(months / 12);
    const rest = months % 12;
    if (rest) return `${plural(years, "year")} and ${plural(rest, "month")}`;
    return days
      ? `${plural(years, "year")} and ${plural(days, "day")}`
      : plural(years, "year");
  }
  if (months >= 1) {
    return days
      ? `${plural(months, "month")} and ${plural(days, "day")}`
      : plural(months, "month");
  }
  return plural(days, "day");
}

// Safe link target for an entry's URL: http(s) only, bare hosts get https://.
// Returns null for empty or non-web URLs (e.g. javascript:).
// Every whitespace-separated search term must appear in some field, and the
// entry must carry every selected label (case-insensitive).
export function filterEntries(
  entries: VaultEntry[],
  query: string,
  labels: string[] = [],
): VaultEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const wanted = labels.map((l) => l.toLowerCase());
  if (!terms.length && !wanted.length) return entries;
  return entries.filter((e) => {
    const own = e.labels.map((l) => l.toLowerCase());
    if (!wanted.every((l) => own.includes(l))) return false;
    const fields = [e.name, e.username, e.email, e.url, e.notes, ...e.labels].map(
      (f) => f.toLowerCase(),
    );
    return terms.every((t) => fields.some((f) => f.includes(t)));
  });
}

export type DuplicateMatch = {
  entry: VaultEntry; // the existing entry it duplicates
  // how the site matched: same name, or (when names differ) same URL
  site: "name" | "url";
  // `entry` login field(s) that matched — "username", "email", or both.
  via: ("username" | "email")[];
  login: string; // the first shared login value, as typed on `entry`
};

const norm = (v: string) => v.trim().toLowerCase();

// URL comparison for dedup: the hostname only — scheme, path, query and
// port are ignored, a schemeless value is still parsed ("github.com"),
// and a leading "www." is dropped ("www.github.com" == "github.com").
// Other subdomains stay distinct ("m.github.com" != "github.com").
// Returns "" for empty or unparseable values.
const normHost = (v: string): string => {
  const trimmed = v.trim();
  if (!trimmed) return "";
  try {
    const host = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    ).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
};

// Another entry for the same site (same name, or same host when names
// differ) that also shares a username or email with `entry` — either
// login field may match either field. An entry with neither a name nor a
// URL, or with no username/email, never matches.
export function findDuplicate(
  entry: VaultEntry,
  entries: VaultEntry[],
): DuplicateMatch | null {
  const name = norm(entry.name);
  const host = normHost(entry.url);
  const logins = ([entry.username, entry.email] as const).filter((v) =>
    norm(v),
  );
  if ((!name && !host) || !logins.length) return null;
  for (const other of entries) {
    if (other.id === entry.id) continue;
    const site =
      name && norm(other.name) === name
        ? "name"
        : host && normHost(other.url) === host
          ? "url"
          : null;
    if (!site) continue;
    const theirs = [other.username, other.email].map(norm);
    const via = ([
      ["username", entry.username],
      ["email", entry.email],
    ] as const)
      .filter(([, v]) => norm(v) && theirs.includes(norm(v)))
      .map(([f]) => f);
    if (via.length) {
      return {
        entry: other,
        site,
        via,
        login: logins.find((v) => theirs.includes(norm(v)))!.trim(),
      };
    }
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function entryHref(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const hasScheme =
    /^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^[^/:]+:\d+(\/|$)/.test(trimmed);
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}
