import { VaultError } from "@/crypto";

// The decrypted vault payload — the JSON document inside the ciphertext.
// Never leaves the client unencrypted.

export const VAULT_DATA_FORMAT = "portunus-vault-data";
export const VAULT_DATA_VERSION = 1;

export type VaultEntry = {
  id: string;
  name: string;
  username: string;
  email: string;
  password: string;
  url: string;
  notes: string;
  updatedAt: string; // ISO 8601
};

export type VaultData = {
  entries: VaultEntry[];
};

const te = new TextEncoder();
const td = new TextDecoder();

export function emptyVaultData(): VaultData {
  return { entries: [] };
}

export function newEntry(): VaultEntry {
  return {
    id: crypto.randomUUID(),
    name: "",
    username: "",
    email: "",
    password: "",
    url: "",
    notes: "",
    updatedAt: new Date().toISOString(),
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
  const entries = (obj.entries as Record<string, unknown>[]).map((e) => ({
    id: typeof e.id === "string" ? e.id : crypto.randomUUID(),
    name: typeof e.name === "string" ? e.name : "",
    username: typeof e.username === "string" ? e.username : "",
    email: typeof e.email === "string" ? e.email : "",
    password: typeof e.password === "string" ? e.password : "",
    url: typeof e.url === "string" ? e.url : "",
    notes: typeof e.notes === "string" ? e.notes : "",
    updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : new Date(0).toISOString(),
  }));
  return { entries };
}

// Safe link target for an entry's URL: http(s) only, bare hosts get https://.
// Returns null for empty or non-web URLs (e.g. javascript:).
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
