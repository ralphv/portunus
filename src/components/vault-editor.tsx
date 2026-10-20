"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { checkPasswordStrength } from "@/lib/password-strength";
import type { PasswordStrength } from "@/lib/password-strength";
import { checkPasswordPwned } from "@/lib/pwned-passwords";
import { generatePassword } from "@/lib/password-gen";
import {
  applyPwnedCheck,
  entryHref,
  filterEntries,
  formatElapsed,
  newEntry,
  normalizeLabels,
} from "@/lib/vault-doc";
import type { VaultData, VaultEntry } from "@/lib/vault-doc";

const PWNED_CHECK_DEBOUNCE_MS = 800;
const STRENGTH_DEBOUNCE_MS = 250;

const inputCls =
  "w-full rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-bronze";
const passwordInputCls = `${inputCls} font-mono`;
const labelCls = "block text-xs uppercase tracking-wider text-slate-500";
const chipBaseCls =
  "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs";
const chipCls = `${chipBaseCls} border-bronze/40 bg-bronze/10 text-bronze`;
const pwnedChipCls =
  "inline-flex max-w-full items-center gap-1 rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-red-300";

const STRENGTH_LABELS = [
  "Very weak",
  "Weak",
  "Fair",
  "Strong",
  "Excellent",
];
const STRENGTH_COLORS = [
  "bg-red-500",
  "bg-red-400",
  "bg-amber-400",
  "bg-emerald-400",
  "bg-emerald-300",
];

// Thin 5-segment meter; fill follows zxcvbn's 0–4 score with a
// red → amber → emerald ramp.
function PasswordMeter({
  strength,
  checking,
}: {
  strength: PasswordStrength | null;
  checking: boolean;
}) {
  const filled = strength ? strength.score + 1 : 0;
  const color = strength ? STRENGTH_COLORS[strength.score] : "bg-slate-600";
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1" role="meter" aria-label="Password strength"
        aria-valuemin={0} aria-valuemax={5} aria-valuenow={filled}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i < filled ? color : "bg-slate-700"
            }`}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-400">
        {strength ? (
          <>
            <span className={strength.score <= 1 ? "text-red-300" : strength.score === 2 ? "text-amber-300" : "text-emerald-300"}>
              {STRENGTH_LABELS[strength.score]}
            </span>
            <span className="text-slate-500"> · {strength.crackTime} to crack</span>
            {strength.hint && (
              <span className="block text-slate-500">{strength.hint}</span>
            )}
          </>
        ) : (
          <span className="text-slate-500">
            {checking ? "scoring…" : ""}
          </span>
        )}
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "unknown"
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Defers work until the browser is idle so it never blocks rendering.
function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: 500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}

function useLabelSuggestions(entries: VaultEntry[]): string[] {
  const [labels, setLabels] = useState<string[]>([]);
  useEffect(
    () =>
      whenIdle(() => {
        const all = normalizeLabels(entries.flatMap((e) => e.labels));
        all.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        setLabels(all);
      }),
    [entries],
  );
  return labels;
}

// Ticks once a minute so elapsed times stay current while the vault is open.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function LabelEditor({
  labels,
  suggestions,
  readOnly,
  onChange,
}: {
  labels: string[];
  suggestions: string[];
  readOnly: boolean;
  onChange: (labels: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);

  function add(label: string) {
    onChange(normalizeLabels([...labels, label]));
    setInput("");
  }

  const q = input.trim().toLowerCase();
  const taken = new Set(labels.map((l) => l.toLowerCase()));
  const matches = q
    ? suggestions
        .filter((s) => !taken.has(s.toLowerCase()) && s.toLowerCase().includes(q))
        .slice(0, 8)
    : [];

  return (
    <div>
      <label className={labelCls}>Labels</label>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {labels.map((label) => (
          <span key={label} className={chipCls}>
            <span className="truncate">{label}</span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onChange(labels.filter((l) => l !== label))}
                aria-label={`Remove label ${label}`}
                className="text-bronze/70 hover:text-red-300"
              >
                ✕
              </button>
            )}
          </span>
        ))}
        {readOnly && labels.length === 0 && (
          <span className="text-xs text-slate-500">—</span>
        )}
      </div>
      {!readOnly && (
        <div
          className="relative mt-2"
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            // Focus moving to a suggestion stays inside; anywhere else
            // (e.g. Done) commits the typed label so it isn't lost.
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setFocused(false);
            if (input.trim()) add(input);
          }}
        >
          <input
            className={inputCls}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === ",") && input.trim()) {
                e.preventDefault();
                add(input);
              } else if (e.key === "Enter") {
                e.preventDefault();
              } else if (e.key === "Backspace" && !input && labels.length) {
                onChange(labels.slice(0, -1));
              }
            }}
            placeholder="Add label…"
            autoComplete="off"
            aria-label="Add label"
          />
          {focused && matches.length > 0 && (
            <ul
              role="listbox"
              className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-600 bg-navy-800 py-1 shadow-xl shadow-black/40"
            >
              {matches.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    // Keep focus in the input on mouse; click covers keyboard too.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(s)}
                    className="block w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-navy-700 hover:text-slate-100"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ItemHistory({
  entry,
  passwordPending,
  now,
  copied,
  copy,
}: {
  entry: VaultEntry;
  passwordPending: boolean;
  now: number;
  copied: string | null;
  copy: (text: string, key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [prevOpen, setPrevOpen] = useState(false);
  const [shown, setShown] = useState<Record<number, boolean>>({});
  const history = entry.passwordHistory;

  return (
    <div className="rounded-lg border border-slate-700/70 bg-navy-900/40 px-3 py-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`${labelCls} hover:text-slate-300`}
      >
        {open ? "▾" : "▸"} Item History
      </button>
      {passwordPending && (
        <p className="mt-2 text-xs text-amber-300">
          Password changed — history updates when you save.
        </p>
      )}
      {open && (
        <>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-slate-500">Created</dt>
            <dd className="text-slate-300">{formatDate(entry.createdAt)}</dd>
            <dt className="text-slate-500">Last password update</dt>
            <dd className="text-slate-300">
              {formatDate(entry.passwordUpdatedAt)}
              <span className="text-slate-500">
                {" "}
                ({formatElapsed(entry.passwordUpdatedAt, new Date(now))} ago)
              </span>
            </dd>
            <dt className="text-slate-500">Password updates</dt>
            <dd className="text-slate-300">{entry.passwordUpdateCount}</dd>
            {entry.pwnedCheck && (
              <>
                <dt className="text-slate-500">Breach check</dt>
                <dd
                  className={
                    entry.pwnedCheck.pwned
                      ? "text-red-300"
                      : "text-slate-300"
                  }
                >
                  {entry.pwnedCheck.pwned
                    ? `Found in breaches (${entry.pwnedCheck.count.toLocaleString()} sightings)`
                    : "Not found in known breaches"}
                  <span className="text-slate-500">
                    {" "}
                    · {formatDate(entry.pwnedCheck.checkedAt)}
                  </span>
                </dd>
              </>
            )}
          </dl>
          {history.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setPrevOpen((o) => !o)}
                aria-expanded={prevOpen}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                {prevOpen ? "▾" : "▸"} Previous Passwords ({history.length})
              </button>
              {prevOpen && (
                <ul className="mt-2 space-y-2">
                  {history.map((h, i) => (
                    <li key={`${h.replacedAt}-${i}`}>
                      <div className="flex gap-2">
                        <input
                          className={passwordInputCls}
                          type={shown[i] ? "text" : "password"}
                          value={h.password}
                          readOnly
                          autoComplete="off"
                          aria-label={`Previous password ${i + 1}`}
                        />
                        <button
                          type="button"
                          onClick={() => setShown((s) => ({ ...s, [i]: !s[i] }))}
                          className="shrink-0 rounded-lg border border-slate-600 px-3 text-xs text-slate-400 hover:text-slate-200"
                        >
                          {shown[i] ? "hide" : "show"}
                        </button>
                        <button
                          type="button"
                          onClick={() => copy(h.password, `h-${entry.id}-${i}`)}
                          className="shrink-0 rounded-lg border border-slate-600 px-3 text-xs text-slate-400 hover:text-slate-200"
                        >
                          {copied === `h-${entry.id}-${i}` ? "copied ✓" : "copy"}
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Replaced {formatDate(h.replacedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function VaultEditor({
  data,
  saved,
  readOnly = false,
  hibpOnEdit = true,
  onChange,
}: {
  data: VaultData; // current draft
  saved: VaultData; // last successfully loaded/saved snapshot
  readOnly?: boolean;
  // PORTUNUS_HIBP_ON_EDIT: silent Have-I-Been-Pwned re-checks on
  // password edits. The manual menu audit is unaffected.
  hibpOnEdit?: boolean;
  onChange: (next: VaultData) => void;
}) {
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});
  const labelSuggestions = useLabelSuggestions(data.entries);
  const savedPasswords = useMemo(
    () => new Map(saved.entries.map((e) => [e.id, e.password])),
    [saved],
  );
  const now = useNow();

  // Refs so delayed/async checks (debounced pwned lookup, zxcvbn scoring)
  // always see the newest data and the current onChange, not the closure
  // they were scheduled from. Edit handlers must read entries from
  // dataRef too — the `data` prop lags `commit()` by one render, so a
  // handler built on it can clobber results committed in between (e.g.
  // an audit result dropped by the next keystroke).
  const dataRef = useRef(data);
  const onChangeRef = useRef(onChange);
  const readOnlyRef = useRef(readOnly);
  const pwnedTimers = useRef(new Map<string, number>());
  const pwPasted = useRef(new Set<string>());
  // Password-strength results cached by password value — scored in the
  // background as entries appear/change, so the meter is already filled
  // when an entry is opened. Entries sharing a password share a result.
  const [strengths, setStrengths] = useState<Map<string, PasswordStrength>>(
    () => new Map(),
  );
  const strengthInFlight = useRef(new Set<string>());

  useEffect(() => {
    dataRef.current = data;
    onChangeRef.current = onChange;
    readOnlyRef.current = readOnly;
  });

  useEffect(
    () => () => {
      for (const t of pwnedTimers.current.values()) clearTimeout(t);
    },
    [],
  );

  const commit = (next: VaultData) => {
    dataRef.current = next;
    onChangeRef.current(next);
  };

  function schedulePwnedCheck(id: string, password: string, delayMs: number) {
    if (readOnlyRef.current || !hibpOnEdit || !password) return;
    const prev = pwnedTimers.current.get(id);
    if (prev !== undefined) clearTimeout(prev);
    pwnedTimers.current.set(
      id,
      window.setTimeout(() => {
        pwnedTimers.current.delete(id);
        void runPwnedCheck(id, password);
      }, delayMs),
    );
  }

  // A pending check fires immediately on blur — the user is done typing.
  function flushPwnedCheck(id: string) {
    const t = pwnedTimers.current.get(id);
    if (t === undefined) return;
    clearTimeout(t);
    pwnedTimers.current.delete(id);
    const entry = dataRef.current.entries.find((e) => e.id === id);
    if (entry?.password) void runPwnedCheck(id, entry.password);
  }

  // Silent post-edit check. Result is dropped if the password changed
  // again while the request was in flight.
  async function runPwnedCheck(id: string, password: string) {
    try {
      const result = await checkPasswordPwned(password);
      const cur = dataRef.current.entries.find((e) => e.id === id);
      if (!cur || cur.password !== password) return;
      // Route through commit so dataRef updates synchronously — two
      // checks resolving in the same React batch must build on each
      // other, not on the same stale snapshot.
      commit({
        entries: dataRef.current.entries.map((e) =>
          e.id === id
            ? applyPwnedCheck(e, {
                checkedAt: new Date().toISOString(),
                pwned: result.pwned,
                count: result.count,
              })
            : e,
        ),
      });
    } catch {
      // Offline or API error — the cleared state stays; nothing to
      // surface for a silent check.
    }
  }

  function patchEntry(id: string, patch: Partial<VaultEntry>) {
    const now = new Date().toISOString();
    commit({
      entries: dataRef.current.entries.map((e) => {
        if (e.id !== id) return e;
        let updated: VaultEntry = {
          ...e,
          ...patch,
          updatedAt: now,
        };
        if (patch.password !== undefined && patch.password !== e.password) {
          // Password changed: stale check + "pwned" label clear right away;
          // a fresh check fires after typing stops (or at once on paste).
          updated = applyPwnedCheck(updated, undefined);
          schedulePwnedCheck(
            id,
            updated.password,
            pwPasted.current.delete(id) ? 0 : PWNED_CHECK_DEBOUNCE_MS,
          );
        }
        return updated;
      }),
    });
  }

  function addEntry() {
    const entry = newEntry();
    commit({ entries: [entry, ...dataRef.current.entries] });
    setOpenId(entry.id);
  }

  function removeEntry(id: string) {
    const entry = dataRef.current.entries.find((e) => e.id === id);
    if (!entry) return;
    if (!window.confirm(`Delete "${entry.name || "untitled"}"?`)) return;
    commit({
      entries: dataRef.current.entries.filter((e) => e.id !== id),
    });
    if (openId === id) setOpenId(null);
  }

  function copy(text: string, key: string) {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  const isFiltered = (label: string) =>
    labelFilter.some((l) => l.toLowerCase() === label.toLowerCase());

  function toggleLabelFilter(label: string) {
    setLabelFilter((cur) =>
      isFiltered(label)
        ? cur.filter((l) => l.toLowerCase() !== label.toLowerCase())
        : [...cur, label],
    );
  }

  // Score every non-empty password once, shortly after it changes — the
  // lazy zxcvbn load + debounce happen here, not when the user opens an
  // entry.
  useEffect(() => {
    const pending = [
      ...new Set(
        data.entries
          .map((e) => e.password)
          .filter(
            (pw) =>
              pw && !strengths.has(pw) && !strengthInFlight.current.has(pw),
          ),
      ),
    ];
    if (!pending.length) return;
    const t = setTimeout(() => {
      void (async () => {
        for (const pw of pending) {
          strengthInFlight.current.add(pw);
          try {
            const s = await checkPasswordStrength(pw);
            setStrengths((cur) => new Map(cur).set(pw, s));
          } catch {
            // Scoring failure leaves the meter hidden; retried on next
            // data change.
          } finally {
            strengthInFlight.current.delete(pw);
          }
        }
      })();
    }, STRENGTH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [data.entries, strengths]);

  // Keep selected labels visible even if no entry carries them anymore.
  const filterChips = normalizeLabels([...labelSuggestions, ...labelFilter]);
  // The open entry stays visible so Add (blank entry) and edits that stop
  // matching the search/filter don't make the editor vanish.
  const matched = new Set(filterEntries(data.entries, search, labelFilter));
  const visible = data.entries.filter((e) => matched.has(e) || e.id === openId);

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entries…"
            autoFocus
            aria-describedby="entry-count"
            className={`${inputCls} pr-24`}
          />
          <span
            id="entry-count"
            aria-live="polite"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-500"
          >
            {visible.length} {visible.length === 1 ? "entry" : "entries"}
          </span>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={addEntry}
            className="shrink-0 rounded-lg border border-bronze/60 px-4 py-2 text-sm font-medium text-bronze transition hover:bg-bronze/10"
          >
            + Add
          </button>
        )}
      </div>

      {filterChips.length > 0 && (
        <div
          role="group"
          aria-label="Filter by label"
          className="mt-3 flex flex-wrap items-center gap-1.5"
        >
          {filterChips.map((label) => {
            const on = isFiltered(label);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => toggleLabelFilter(label)}
                className={`${chipBaseCls} transition ${
                  on
                    ? "border-bronze bg-bronze font-medium text-navy-900"
                    : "border-slate-600 bg-transparent text-slate-400 hover:border-bronze/60 hover:text-bronze"
                }`}
              >
                <span className="truncate">{label}</span>
              </button>
            );
          })}
          {labelFilter.length > 0 && (
            <button
              type="button"
              onClick={() => setLabelFilter([])}
              className="px-1 text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {visible.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-500">
          {data.entries.length === 0
            ? "Empty vault — add your first entry."
            : "No entries match your search."}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {visible.map((entry) => {
          const open = openId === entry.id;
          const href = entryHref(entry.url);
          const pwned = entry.pwnedCheck?.pwned === true;
          return (
            <li
              key={entry.id}
              className={`rounded-xl border bg-navy-800/60 ${
                pwned
                  ? "border-red-500/50 bg-red-500/[0.04]"
                  : "border-slate-700/70"
              }`}
            >
              <div className="relative flex items-center justify-between px-4 py-3">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : entry.id)}
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${entry.name || "Untitled"}`}
                  className="absolute inset-0 rounded-xl"
                />
                <div className="pointer-events-none relative min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-slate-100">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pointer-events-auto truncate underline decoration-slate-600 underline-offset-2 hover:text-bronze hover:decoration-bronze"
                      >
                        {entry.name || "Untitled"}
                      </a>
                    ) : (
                      <span className="truncate">
                        {entry.name || "Untitled"}
                      </span>
                    )}
                    {pwned && <span className={pwnedChipCls}>pwned</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {entry.username || entry.email || entry.url || "—"}
                  </p>
                  {!open && entry.labels.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {entry.labels.map((label) => (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={isFiltered(label)}
                          title={`Filter by ${label}`}
                          onClick={() => toggleLabelFilter(label)}
                          className={`${chipCls} pointer-events-auto hover:bg-bronze/20`}
                        >
                          <span className="truncate">{label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className="pointer-events-none relative ml-3 text-slate-500">
                  {open ? "▾" : "▸"}
                </span>
              </div>

              {!open && (entry.username || entry.email || entry.password) && (
                <div className="flex gap-2 px-4 pb-3">
                  {entry.username && (
                    <button
                      type="button"
                      onClick={() => copy(entry.username, `u-${entry.id}`)}
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
                    >
                      {copied === `u-${entry.id}` ? "copied ✓" : "copy user"}
                    </button>
                  )}
                  {entry.email && (
                    <button
                      type="button"
                      onClick={() => copy(entry.email, `e-${entry.id}`)}
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
                    >
                      {copied === `e-${entry.id}` ? "copied ✓" : "copy email"}
                    </button>
                  )}
                  {entry.password && (
                    <button
                      type="button"
                      onClick={() => copy(entry.password, `p-${entry.id}`)}
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
                    >
                      {copied === `p-${entry.id}` ? "copied ✓" : "copy pass"}
                    </button>
                  )}
                </div>
              )}

              {open && (
                <div className="space-y-3 border-t border-slate-700/70 px-4 py-4">
                  <div>
                    <label className={labelCls}>Name</label>
                    <input
                      className={`${inputCls} mt-1`}
                      value={entry.name}
                      onChange={(e) => patchEntry(entry.id, { name: e.target.value })}
                      placeholder="example.com"
                      disabled={readOnly}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelCls}>Username</label>
                      <input
                        className={`${inputCls} mt-1`}
                        value={entry.username}
                        onChange={(e) =>
                          patchEntry(entry.id, { username: e.target.value })
                        }
                        autoComplete="off"
                        disabled={readOnly}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Password</label>
                      <div className="mt-1 flex gap-2">
                        <input
                          className={passwordInputCls}
                          type={showPw[entry.id] ? "text" : "password"}
                          value={entry.password}
                          onChange={(e) =>
                            patchEntry(entry.id, { password: e.target.value })
                          }
                          onPaste={() => pwPasted.current.add(entry.id)}
                          onBlur={() => flushPwnedCheck(entry.id)}
                          autoComplete="off"
                          disabled={readOnly}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowPw((s) => ({ ...s, [entry.id]: !s[entry.id] }))
                          }
                          className="shrink-0 rounded-lg border border-slate-600 px-3 text-xs text-slate-400 hover:text-slate-200"
                        >
                          {showPw[entry.id] ? "hide" : "show"}
                        </button>
                      </div>
                      {entry.password && open && (
                        <PasswordMeter
                          strength={strengths.get(entry.password) ?? null}
                          checking={!strengths.has(entry.password)}
                        />
                      )}
                      {entry.pwnedCheck?.pwned && (
                        <p className="mt-2 text-xs text-red-300">
                          Seen {entry.pwnedCheck.count.toLocaleString()} times
                          in breaches — change this password
                        </p>
                      )}
                      <div className="mt-2 flex gap-2">
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() =>
                              patchEntry(entry.id, { password: generatePassword() })
                            }
                            className="rounded border border-bronze/50 px-2 py-1 text-xs text-bronze hover:bg-bronze/10"
                          >
                            Generate
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => copy(entry.password, `p-${entry.id}`)}
                          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                        >
                          {copied === `p-${entry.id}` ? "copied ✓" : "copy"}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Email</label>
                    <input
                      className={`${inputCls} mt-1`}
                      type="email"
                      value={entry.email}
                      onChange={(e) =>
                        patchEntry(entry.id, { email: e.target.value })
                      }
                      autoComplete="off"
                      disabled={readOnly}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>URL</label>
                    <input
                      className={`${inputCls} mt-1`}
                      value={entry.url}
                      onChange={(e) => patchEntry(entry.id, { url: e.target.value })}
                      placeholder="https://…"
                      autoComplete="off"
                      disabled={readOnly}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Notes</label>
                    <textarea
                      className={`${inputCls} mt-1 min-h-20`}
                      value={entry.notes}
                      onChange={(e) => patchEntry(entry.id, { notes: e.target.value })}
                      disabled={readOnly}
                    />
                  </div>
                  <LabelEditor
                    labels={entry.labels}
                    suggestions={labelSuggestions}
                    readOnly={readOnly}
                    onChange={(labels) => patchEntry(entry.id, { labels })}
                  />
                  <ItemHistory
                    key={entry.id}
                    entry={entry}
                    passwordPending={
                      savedPasswords.has(entry.id) &&
                      savedPasswords.get(entry.id) !== entry.password
                    }
                    now={now}
                    copied={copied}
                    copy={copy}
                  />
                  <div className={`flex pt-1 ${readOnly ? "justify-end" : "justify-between"}`}>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => removeEntry(entry.id)}
                        className="rounded border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setOpenId(null)}
                      className="rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-600"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
