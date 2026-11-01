import type { VaultEntry } from "@/lib/vault-doc";

// Display-only ordering of the entry list. Sorting never touches the vault
// document: the stored entry order is left as-is and only the rendered list
// is reordered. The choice is a per-device UI preference (localStorage).

export const SORT_ORDERS = [
  { id: "vault", label: "Vault Order" },
  { id: "name-asc", label: "Name (A-Z)" },
  { id: "name-desc", label: "Name (Z-A)" },
  { id: "created-asc", label: "Oldest first" },
  { id: "created-desc", label: "Newest first" },
  { id: "password-old", label: "Oldest Password" },
  { id: "password-new", label: "Newest Password" },
] as const;

export type SortOrder = (typeof SORT_ORDERS)[number]["id"];

export const DEFAULT_SORT_ORDER: SortOrder = "vault";

export function isSortOrder(v: unknown): v is SortOrder {
  return SORT_ORDERS.some((o) => o.id === v);
}

export type SortFields = Pick<
  VaultEntry,
  "id" | "name" | "createdAt" | "passwordUpdatedAt"
>;

const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

// Blank values sort after non-blank ones whichever direction is chosen.
function byText(a: string, b: string, dir: 1 | -1): number {
  const x = a.trim();
  const y = b.trim();
  if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1);
  return dir * collator.compare(x, y);
}

const time = (iso: string) => Date.parse(iso) || 0;

function compare(a: SortFields, b: SortFields, order: SortOrder): number {
  switch (order) {
    case "name-asc":
      return byText(a.name, b.name, 1);
    case "name-desc":
      return byText(a.name, b.name, -1);
    case "created-desc":
      return time(b.createdAt) - time(a.createdAt);
    case "created-asc":
      return time(a.createdAt) - time(b.createdAt);
    case "password-old":
      return time(a.passwordUpdatedAt) - time(b.passwordUpdatedAt);
    case "password-new":
      return time(b.passwordUpdatedAt) - time(a.passwordUpdatedAt);
    case "vault":
      return 0;
  }
}

// Returns a sorted copy; ties keep vault order (Array.sort is stable).
// `basis` supplies the values to sort by per entry id — pass the last-saved
// snapshot so an entry doesn't jump around while its name/timestamps are
// being edited. Entries missing from `basis` (added, not yet saved) are
// listed first, in vault order.
export function sortEntries<T extends SortFields>(
  entries: T[],
  order: SortOrder,
  basis?: ReadonlyMap<string, SortFields>,
): T[] {
  if (order === "vault") return entries;
  const keyOf = (e: T): SortFields | undefined =>
    basis ? basis.get(e.id) : e;
  return [...entries].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (!ka || !kb) return (ka ? 1 : 0) - (kb ? 1 : 0);
    return compare(ka, kb, order);
  });
}
