"use client";

import { useEffect, useMemo, useState } from "react";

import { generatePassword } from "@/lib/password-gen";
import {
  entryHref,
  formatElapsed,
  newEntry,
  normalizeLabels,
} from "@/lib/vault-doc";
import type { VaultData, VaultEntry } from "@/lib/vault-doc";

const inputCls =
  "w-full rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-bronze";
const passwordInputCls = `${inputCls} font-mono`;
const labelCls = "block text-xs uppercase tracking-wider text-slate-500";
const chipCls =
  "inline-flex max-w-full items-center gap-1 rounded-full border border-bronze/40 bg-bronze/10 px-2 py-0.5 text-xs text-bronze";

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
        <div className="relative mt-2">
          <input
            className={inputCls}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
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
                    // mousedown, not click: keep focus in the input.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      add(s);
                    }}
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
  onChange,
}: {
  data: VaultData; // current draft
  saved: VaultData; // last successfully loaded/saved snapshot
  readOnly?: boolean;
  onChange: (next: VaultData) => void;
}) {
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});
  const labelSuggestions = useLabelSuggestions(data.entries);
  const savedPasswords = useMemo(
    () => new Map(saved.entries.map((e) => [e.id, e.password])),
    [saved],
  );
  const now = useNow();

  const commit = onChange;

  function patchEntry(id: string, patch: Partial<VaultEntry>) {
    commit({
      entries: data.entries.map((e) =>
        e.id === id ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e,
      ),
    });
  }

  function addEntry() {
    const entry = newEntry();
    commit({ entries: [entry, ...data.entries] });
    setOpenId(entry.id);
  }

  function removeEntry(id: string) {
    const entry = data.entries.find((e) => e.id === id);
    if (!entry) return;
    if (!window.confirm(`Delete "${entry.name || "untitled"}"?`)) return;
    commit({ entries: data.entries.filter((e) => e.id !== id) });
    if (openId === id) setOpenId(null);
  }

  function copy(text: string, key: string) {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  const q = search.trim().toLowerCase();
  const visible = q
    ? data.entries.filter((e) =>
        [e.name, e.username, e.email, e.url, e.notes, ...e.labels].some((f) =>
          f.toLowerCase().includes(q),
        ),
      )
    : data.entries;

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search entries…"
          autoFocus
          className={inputCls}
        />
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
          return (
            <li
              key={entry.id}
              className="rounded-xl border border-slate-700/70 bg-navy-800/60"
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
                  <p className="truncate text-sm font-medium text-slate-100">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pointer-events-auto underline decoration-slate-600 underline-offset-2 hover:text-bronze hover:decoration-bronze"
                      >
                        {entry.name || "Untitled"}
                      </a>
                    ) : (
                      entry.name || "Untitled"
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {entry.username || entry.email || entry.url || "—"}
                  </p>
                  {!open && entry.labels.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {entry.labels.map((label) => (
                        <span key={label} className={chipCls}>
                          <span className="truncate">{label}</span>
                        </span>
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
