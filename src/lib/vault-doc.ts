import { VaultError } from "@/crypto";

// The decrypted vault payload — the JSON document inside the ciphertext.
// Never leaves the client unencrypted.

export const VAULT_DATA_FORMAT = "portunus-vault-data";
export const VAULT_DATA_VERSION = 1;

export const PASSWORD_HISTORY_LIMIT = 5;

export type PasswordHistoryItem = {
  password: string;
  replacedAt: string; // ISO 8601
};

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
};

export type VaultData = {
  entries: VaultEntry[];
};

const te = new TextEncoder();
const td = new TextDecoder();

export function emptyVaultData(): VaultData {
  return { entries: [] };
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
  };
}

export function serializeVaultData(data: VaultData): Uint8Array {
  return te.encode(
    JSON.stringify({
      format: VAULT_DATA_FORMAT,
      version: VAULT_DATA_VERSION,
      entries: data.entries,
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
  return { entries: obj.entries.map(normalizeEntry) };
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
