"use client";

import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

import { AUTO_LOCK_IDLE_S } from "@/constants";
import { uninstallKeyfile, VaultUnlockError } from "@/crypto";
import {
  parseVaultData,
  saveVaultDraft,
  serializeVaultData,
} from "@/lib/vault-doc";
import type { VaultData } from "@/lib/vault-doc";
import {
  fetchRemoteVault,
  VaultRemoteError,
  VaultSession,
} from "@/lib/vault-session";
import { VaultEditor } from "./vault-editor";
import { VaultSecurity } from "./vault-security";

// Auto-lock after idle, unless unsaved changes exist — losing work would be
// worse than staying unlocked a little longer.
function useAutoLock(dirty: boolean, onLock: () => void): number | null {
  const [secondsLeft, setSecondsLeft] = useState(AUTO_LOCK_IDLE_S);
  const lastActivity = useRef(0);

  useEffect(() => {
    lastActivity.current = Date.now();
    const bump = () => {
      lastActivity.current = Date.now();
    };
    const events = [
      "pointerdown",
      "pointermove",
      "keydown",
      "wheel",
      "touchstart",
    ] as const;
    for (const e of events) {
      window.addEventListener(e, bump, { passive: true });
    }
    const t = setInterval(() => {
      const elapsed = Math.floor(
        (Date.now() - lastActivity.current) / 1000,
      );
      setSecondsLeft(Math.max(0, AUTO_LOCK_IDLE_S - elapsed));
      if (elapsed >= AUTO_LOCK_IDLE_S && !dirty) onLock();
    }, 1000);
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      clearInterval(t);
    };
  }, [dirty, onLock]);

  return dirty ? null : secondsLeft;
}

export function VaultOpen({
  session,
  email,
  offline,
  keyfileInstalled,
  onRemoveKeyfile,
  onLock,
}: {
  session: VaultSession;
  email: string | null;
  offline: boolean;
  keyfileInstalled: boolean;
  onRemoveKeyfile: () => void;
  onLock: () => void;
}) {
  const [version, setVersion] = useState(0); // bumped when session contents change
  // `draft` is what the editor shows (and what session.data holds); `saved`
  // is the snapshot from the last successful load/save. Password metadata
  // is derived from the difference between the two at save time only.
  const [loaded] = useState(() => parseVaultData(session.data));
  const [draft, setDraft] = useState<VaultData>(loaded);
  const [saved, setSaved] = useState<VaultData>(loaded);
  const [saveOpen, setSaveOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [savePassword, setSavePassword] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(offline);
  // Drive's copy moved on while we were offline — stay read-only until
  // the user reloads (lock + unlock) to avoid clobbering it.
  const [remoteChanged, setRemoteChanged] = useState(false);
  const secondsLeft = useAutoLock(session.dirty, onLock);

  // Auto-recovery: when connectivity returns, re-check Drive. Unchanged
  // remote → flips back to read-write; changed → stay read-only. The
  // "online" event doesn't fire in every reconnect case, so poll lightly
  // too — this effect only lives while we're offline.
  useEffect(() => {
    if (!isOffline) return;
    const recover = async () => {
      try {
        const remote = await fetchRemoteVault();
        if (!remote || remote.offline) return; // still unreachable / deleted
        if (session.reconnect(remote)) setRemoteChanged(true);
        else setIsOffline(false);
      } catch {
        // Server error or still down — remain read-only.
      }
    };
    const onOnline = () => void recover();
    const t = setInterval(() => void recover(), 30_000);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(t);
    };
  }, [isOffline, session]);

  // Warn before the tab closes/reloads with unsaved changes.
  useEffect(() => {
    if (!session.dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [session.dirty]);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current
      ?.querySelector('[role="menu"]')
      ?.scrollIntoView({ block: "nearest" });
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function requestLock() {
    if (
      session.dirty &&
      !window.confirm("You have unsaved changes — lock anyway?")
    ) {
      return;
    }
    onLock();
  }

  function commitDraft(next: VaultData) {
    setDraft(next);
    session.update(serializeVaultData(next));
  }

  async function saveWith(persist: () => Promise<void>) {
    const next = await saveVaultDraft(session, saved, draft, persist);
    setDraft(next);
    setSaved(next);
  }

  const mm = Math.floor((secondsLeft ?? 0) / 60);
  const ss = String((secondsLeft ?? 0) % 60).padStart(2, "0");

  async function confirmSave(e: React.FormEvent) {
    e.preventDefault();
    if (saveBusy) return;
    setSaveBusy(true);
    setSaveError(null);
    try {
      await session.verifyPassword(savePassword);
      await saveWith(() => session.save());
      setSaveOpen(false);
      setSavePassword("");
      setVersion((v) => v + 1);
    } catch (e) {
      if (e instanceof VaultUnlockError) {
        setSaveError("Wrong password.");
      } else if (e instanceof VaultRemoteError && e.status === 409) {
        setSaveError(
          "The vault changed elsewhere since you unlocked it. Lock and unlock again to reload.",
        );
      } else {
        setSaveError("Save failed — check your connection and try again.");
      }
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm">
          {isOffline ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 px-3 py-1 text-sky-300">
              Offline — read only
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${
                session.dirty
                  ? "border-amber-500/40 text-amber-300"
                  : "border-emerald-500/40 text-emerald-300"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  session.dirty ? "bg-amber-400" : "bg-emerald-400"
                }`}
              />
              {session.dirty ? "Unsaved changes" : "Synced"}
            </span>
          )}
          <span className="rounded-full border border-slate-700 px-3 py-1 font-mono text-xs text-slate-400">
            {secondsLeft === null
              ? "auto-lock paused"
              : `locks in ${mm}:${ss}`}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!isOffline && (
            <button
              type="button"
              onClick={() => {
                setSavePassword("");
                setSaveError(null);
                setSaveOpen(true);
              }}
              disabled={!session.dirty}
              className="rounded-lg bg-bronze px-4 py-2 text-sm font-medium text-navy-900 transition hover:bg-bronze-light disabled:opacity-40"
            >
              Save
            </button>
          )}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex h-9 w-10 flex-col items-center justify-center gap-1 rounded-lg border border-slate-600 text-slate-300 transition hover:border-slate-400 hover:text-slate-100"
            >
              <span className="h-0.5 w-4 rounded bg-current" />
              <span className="h-0.5 w-4 rounded bg-current" />
              <span className="h-0.5 w-4 rounded bg-current" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-50 mt-2 w-56 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-slate-600 bg-navy-800 py-1 shadow-2xl shadow-black/40"
              >
                <div className="px-4 py-2 text-xs text-slate-400">
                  Signed in as
                  <span
                    title={email ?? undefined}
                    className="block truncate text-sm font-medium text-slate-100"
                  >
                    {email}
                  </span>
                </div>
                <div role="separator" className="my-1 border-t border-slate-700" />
                {!isOffline && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setSecurityOpen(true);
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-slate-300 transition hover:bg-navy-700 hover:text-slate-100"
                  >
                    Security
                  </button>
                )}
                {keyfileInstalled && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      if (
                        window.confirm(
                          "Remove the keyfile installed in this browser? " +
                            "You'll need your portunus.key file to unlock here next time.",
                        )
                      ) {
                        uninstallKeyfile();
                        onRemoveKeyfile();
                      }
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-slate-400 transition hover:bg-navy-700 hover:text-red-300"
                  >
                    Remove key
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    requestLock();
                  }}
                  className="block w-full px-4 py-2 text-left text-sm text-slate-300 transition hover:bg-navy-700 hover:text-slate-100"
                >
                  Lock
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void signOut();
                  }}
                  className="block w-full px-4 py-2 text-left text-sm text-slate-300 transition hover:bg-navy-700 hover:text-slate-100"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {remoteChanged && (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          The vault changed on Drive while you were offline — lock and
          unlock again to load the latest.
        </p>
      )}

      <VaultEditor
        data={draft}
        saved={saved}
        readOnly={isOffline}
        onChange={commitDraft}
      />
      <span className="hidden">{version}</span>

      {securityOpen && (
        <VaultSecurity
          session={session}
          saveWith={saveWith}
          onChanged={() => setVersion((v) => v + 1)}
          onClose={() => setSecurityOpen(false)}
        />
      )}

      {saveOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={() => !saveBusy && setSaveOpen(false)}
        >
          <form
            onSubmit={confirmSave}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-bronze/30 bg-navy-800 p-6 shadow-2xl"
          >
            <h3 className="font-medium text-slate-100">
              Confirm master password to save
            </h3>
            <input
              type="password"
              value={savePassword}
              onChange={(e) => setSavePassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              className="mt-4 w-full rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2.5 text-slate-100 outline-none focus:border-bronze"
            />
            {saveError && (
              <p className="mt-3 text-sm text-red-300">{saveError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSaveOpen(false)}
                disabled={saveBusy}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saveBusy || !savePassword}
                className="rounded-lg bg-bronze px-4 py-2 text-sm font-medium text-navy-900 disabled:opacity-50"
              >
                {saveBusy ? "Saving…" : "Save to Drive"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
