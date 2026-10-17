"use client";

import { useState } from "react";

import { generatePassword } from "@/lib/password-gen";
import {
  newEntry,
  parseVaultData,
  serializeVaultData,
} from "@/lib/vault-doc";
import type { VaultData, VaultEntry } from "@/lib/vault-doc";
import type { VaultSession } from "@/lib/vault-session";

const inputCls =
  "w-full rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-bronze";
const labelCls = "block text-xs uppercase tracking-wider text-slate-500";

export function VaultEditor({
  session,
  readOnly = false,
  onChanged,
}: {
  session: VaultSession;
  readOnly?: boolean;
  onChanged: () => void;
}) {
  const [data, setData] = useState<VaultData>(() => parseVaultData(session.data));
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});

  function commit(next: VaultData) {
    setData(next);
    session.update(serializeVaultData(next));
    onChanged();
  }

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
        [e.name, e.username, e.email, e.url, e.notes].some((f) =>
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
          return (
            <li
              key={entry.id}
              className="rounded-xl border border-slate-700/70 bg-navy-800/60"
            >
              <button
                type="button"
                onClick={() => setOpenId(open ? null : entry.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {entry.name || "Untitled"}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {entry.username || entry.email || entry.url || "—"}
                  </p>
                </div>
                <span className="ml-3 text-slate-500">{open ? "▾" : "▸"}</span>
              </button>

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
                          className={inputCls}
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
