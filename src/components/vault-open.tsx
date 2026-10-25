"use client";

import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

import { AUTO_LOCK_IDLE_S } from "@/constants";
import { VaultUnlockError } from "@/crypto/errors";
import { uninstallKeyfile } from "@/crypto/keyfile";
import {
  PASSWORD_AUTOFILL_OFF,
  writePasswordFillSave,
} from "@/lib/autofill";
import type { VaultClient } from "@/lib/vault-client";
import { applyPwnedCheck } from "@/lib/vault-doc";
import type { PublicVaultData } from "@/lib/vault-public";
import { fetchRemoteVault, VaultRemoteError } from "@/lib/vault-remote";
import { VaultEditor } from "./vault-editor";
import { VaultSecurity } from "./vault-security";
import { PropertyValueInput } from "@/components/secret-input";

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
  initialData,
  email,
  offline,
  hibpOnEdit,
  keyfileKid,
  keyfileInstalled,
  onRemoveKeyfile,
  onLock,
}: {
  session: VaultClient;
  // Redacted document from unlock; secrets stay in the vault Worker.
  initialData: PublicVaultData;
  email: string | null;
  offline: boolean;
  // PORTUNUS_HIBP_ON_EDIT env flag: gates the silent on-edit check and
  // the HIBP row inside Settings (hidden entirely when off).
  hibpOnEdit: boolean;
  // Keyfile id — scopes the localStorage fill/save mirror to this vault.
  keyfileKid: string | null;
  keyfileInstalled: boolean;
  onRemoveKeyfile: () => void;
  onLock: () => void;
}) {
  const [version, setVersion] = useState(0); // bumped when session contents change
  // `draft` is what the editor shows; `saved` is the snapshot from the last
  // successful load/save. Both are redacted (no secrets — the Worker holds
  // those). Password metadata is derived at save time only, in the Worker.
  const [draft, setDraft] = useState<PublicVaultData>(initialData);
  const [saved, setSaved] = useState<PublicVaultData>(initialData);
  // The audit commits per password as results arrive; the ref lets that
  // loop always see the newest draft, including edits made mid-audit.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInfo, setSettingsInfo] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [savePassword, setSavePassword] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(offline);
  // Have I Been Pwned audit modal state. `done`/`pwned`/`failed` count
  // unique passwords (results are applied to every entry sharing one).
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState({
    total: 0,
    done: 0,
    pwned: 0,
    failed: [] as string[],
    running: false,
  });
  const auditAbort = useRef<AbortController | null>(null);
  // Drive's copy moved on while we were offline — stay read-only until
  // the user reloads (lock + unlock) to avoid clobbering it.
  const [remoteChanged, setRemoteChanged] = useState(false);
  const secondsLeft = useAutoLock(session.dirty, onLock);

  // Mirror "password fill & save" to localStorage (scoped to this
  // vault's keyfile id) so the unlock screen — rendered before the
  // vault is readable — honors the device's last-known preference.
  useEffect(() => {
    if (keyfileKid)
      writePasswordFillSave(keyfileKid, draft.settings.allowPasswordFillSave);
  }, [keyfileKid, draft.settings.allowPasswordFillSave]);

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
        if (await session.call("reconnect", remote)) setRemoteChanged(true);
        else {
          session.markOnline();
          setIsOffline(false);
        }
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

  function commitDraft(next: PublicVaultData) {
    draftRef.current = next;
    setDraft(next);
    session.markDirty();
  }

  // Applies one password's result to every entry currently holding it, so
  // reused passwords are checked once but marked everywhere.
  function applyAuditResult(ids: string[], result: { pwned: boolean; count: number }) {
    const checkedAt = new Date().toISOString();
    const holders = new Set(ids);
    commitDraft({
      ...draftRef.current,
      entries: draftRef.current.entries.map((e) =>
        holders.has(e.id)
          ? applyPwnedCheck(e, {
              checkedAt,
              pwned: result.pwned,
              count: result.count,
            })
          : e,
      ),
    });
  }

  function startAudit() {
    // One audit at a time — reopening the menu while one runs just
    // resurfaces its progress modal.
    if (auditAbort.current) {
      setAuditOpen(true);
      return;
    }
    const entries = draftRef.current.entries.filter((e) => e.hasPassword);
    setAudit({ total: 0, done: 0, pwned: 0, failed: [], running: true });
    setAuditOpen(true);
    const controller = new AbortController();
    auditAbort.current = controller;
    void (async () => {
      // One group per distinct password; the Worker does the grouping so
      // the passwords themselves never come back here.
      let unique: string[][];
      try {
        unique = await session.call(
          "auditGroups",
          entries.map((e) => e.id),
        );
      } catch {
        unique = [];
      }
      if (controller.signal.aborted) return;
      setAudit((s) => ({ ...s, total: unique.length }));
      let first = true;
      for (const group of unique) {
        if (controller.signal.aborted) break;
        // ~100ms between requests to stay polite; skipped before the first.
        if (!first) await new Promise((r) => setTimeout(r, 100));
        first = false;
        if (controller.signal.aborted) break;
        try {
          const checked = await session.call("checkPwnedGroup", group);
          if (controller.signal.aborted) break;
          if (!checked) throw new Error("password changed");
          const { result } = checked;
          applyAuditResult(checked.ids, result);
          setAudit((s) => ({
            ...s,
            done: s.done + 1,
            pwned: s.pwned + (result.pwned ? 1 : 0),
          }));
        } catch {
          if (controller.signal.aborted) break;
          const names = entries
            .filter((e) => group.includes(e.id))
            .map((e) => e.name || "Untitled");
          setAudit((s) => ({
            ...s,
            done: s.done + 1,
            failed: [...s.failed, ...names],
          }));
        }
      }
      // Only the audit that owns the current controller may clear it —
      // a canceled task waking up must not mark a newer audit finished
      // or drop its abort handle.
      if (auditAbort.current === controller) {
        auditAbort.current = null;
        setAudit((s) => ({ ...s, running: false }));
      }
    })();
  }

  function closeAudit() {
    auditAbort.current?.abort();
    auditAbort.current = null;
    setAuditOpen(false);
  }

  async function saveWith(
    persist: (draft: PublicVaultData) => Promise<PublicVaultData>,
  ) {
    const next = await persist(draft);
    setSaved(next);
    // Anything committed while the save was in flight (audit results,
    // silent pwned checks, edits) was NOT part of the uploaded document
    // — installing `next` raw would discard it. Entries unchanged since
    // the save started take the finalized version (fresh history
    // metadata); entries touched mid-save keep their newer version and
    // stay dirty for the next save.
    const latest = draftRef.current;
    if (latest === draft) {
      setDraft(next);
      return;
    }
    const atSave = new Map(draft.entries.map((e) => [e.id, e]));
    const finalized = new Map(next.entries.map((e) => [e.id, e]));
    const merged: PublicVaultData = {
      ...latest,
      entries: latest.entries.map((e) =>
        atSave.get(e.id) === e ? (finalized.get(e.id) ?? e) : e,
      ),
    };
    // Only declare the merge clean when settings also match — a settings
    // toggle mid-save must not be swallowed by `next` (its settings were
    // snapshotted when the save started).
    if (
      merged.settings === next.settings &&
      merged.entries.length === next.entries.length &&
      merged.entries.every((e) => finalized.get(e.id) === e)
    ) {
      setDraft(next);
      return;
    }
    commitDraft(merged);
  }

  // Settings live in the vault document: toggling one edits the draft
  // (dirty → persists on the next Save, like an entry change).
  function patchSettings(patch: Partial<PublicVaultData["settings"]>) {
    commitDraft({
      ...draftRef.current,
      settings: { ...draftRef.current.settings, ...patch },
    });
  }

  const mm = Math.floor((secondsLeft ?? 0) / 60);
  const ss = String((secondsLeft ?? 0) % 60).padStart(2, "0");

  async function confirmSave(e: React.FormEvent) {
    e.preventDefault();
    if (saveBusy) return;
    setSaveBusy(true);
    setSaveError(null);
    try {
      await session.call("verifyPassword", savePassword);
      await saveWith((d) => session.save(d));
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
          <span
            className={`rounded-full border px-3 py-1 font-mono text-xs ${
              secondsLeft === null
                ? "portunus-shine border-amber-500/45 text-amber-300"
                : "border-slate-700 text-slate-400"
            }`}
          >
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
                {!isOffline && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      startAudit();
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-slate-300 transition hover:bg-navy-700 hover:text-slate-100"
                  >
                    Have I Been Pwned
                  </button>
                )}
                {!isOffline && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setSettingsInfo(null);
                      setSettingsOpen(true);
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-slate-300 transition hover:bg-navy-700 hover:text-slate-100"
                  >
                    Settings
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
        vault={session}
        data={draft}
        saved={saved}
        readOnly={isOffline}
        hibpOnEdit={hibpOnEdit && draft.settings.checkPwnedOnEdit}
        allowPasswordFillSave={draft.settings.allowPasswordFillSave}
        onChange={commitDraft}
      />
      <span className="hidden">{version}</span>

      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Settings"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-bronze/30 bg-navy-800 p-6 shadow-2xl"
          >
            <h3 className="font-medium text-slate-100">Settings</h3>
            {hibpOnEdit && (
              <div className="mt-4">
                <div className="flex items-start gap-3">
                  <input
                    id="set-hibp"
                    type="checkbox"
                    checked={draft.settings.checkPwnedOnEdit}
                    onChange={(e) =>
                      patchSettings({ checkPwnedOnEdit: e.target.checked })
                    }
                    className="mt-0.5 h-4 w-4 accent-bronze"
                  />
                  <label
                    htmlFor="set-hibp"
                    className="flex-1 cursor-pointer text-sm text-slate-200"
                  >
                    Have I Been Pwned on edit
                  </label>
                  <button
                    type="button"
                    aria-label="About this setting"
                    aria-expanded={settingsInfo === "hibp"}
                    onClick={() =>
                      setSettingsInfo((s) => (s === "hibp" ? null : "hibp"))
                    }
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-600 text-[10px] leading-none text-slate-400 hover:border-slate-400 hover:text-slate-200"
                  >
                    ?
                  </button>
                </div>
                {settingsInfo === "hibp" && (
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    When you change an entry&apos;s password, Portunus checks it
                    against api.pwnedpasswords.com using k-anonymity — only
                    the first 5 characters of its SHA-1 hash leave this
                    device. Turn this off to stop all automatic contact with
                    that service; the manual check in the menu stays
                    available. Applies after you Save.
                  </p>
                )}
              </div>
            )}
            <div className="mt-4">
              <div className="flex items-start gap-3">
                <input
                  id="set-fill-save"
                  type="checkbox"
                  checked={draft.settings.allowPasswordFillSave}
                  onChange={(e) =>
                    patchSettings({ allowPasswordFillSave: e.target.checked })
                  }
                  className="mt-0.5 h-4 w-4 accent-bronze"
                />
                <label
                  htmlFor="set-fill-save"
                  className="flex-1 cursor-pointer text-sm text-slate-200"
                >
                  Browser password fill &amp; save
                </label>
                <button
                  type="button"
                  aria-label="About this setting"
                  aria-expanded={settingsInfo === "fill-save"}
                  onClick={() =>
                    setSettingsInfo((s) =>
                      s === "fill-save" ? null : "fill-save",
                    )
                  }
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-600 text-[10px] leading-none text-slate-400 hover:border-slate-400 hover:text-slate-200"
                >
                  ?
                </button>
              </div>
              {settingsInfo === "fill-save" && (
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  Lets your browser or OS offer to fill and save passwords in
                  Portunus fields — including the master password. Off by
                  default: those prompts are suppressed everywhere,
                  including the unlock screen on this device. Applies after
                  you Save.
                </p>
              )}
            </div>
            <div className="mt-4">
              <div className="flex items-start gap-3">
                <input
                  id="set-focus-edit"
                  type="checkbox"
                  checked={draft.settings.focusEdit}
                  onChange={(e) =>
                    patchSettings({ focusEdit: e.target.checked })
                  }
                  className="mt-0.5 h-4 w-4 accent-bronze"
                />
                <label
                  htmlFor="set-focus-edit"
                  className="flex-1 cursor-pointer text-sm text-slate-200"
                >
                  Focus mode
                </label>
                <button
                  type="button"
                  aria-label="About this setting"
                  aria-expanded={settingsInfo === "focus"}
                  onClick={() =>
                    setSettingsInfo((s) => (s === "focus" ? null : "focus"))
                  }
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-600 text-[10px] leading-none text-slate-400 hover:border-slate-400 hover:text-slate-200"
                >
                  ?
                </button>
              </div>
              {settingsInfo === "focus" && (
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  When editing or adding an entry, hide the rest of your
                  entries and show only the one you&apos;re working on until
                  you press Done or Delete.
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {securityOpen && (
        <VaultSecurity
          session={session}
          saveWith={saveWith}
          allowPasswordFillSave={draft.settings.allowPasswordFillSave}
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
            <PropertyValueInput
              type="password"
              value={savePassword}
              onValueChange={setSavePassword}
              autoFocus
              {...(draft.settings.allowPasswordFillSave
                ? { autoComplete: "current-password" }
                : PASSWORD_AUTOFILL_OFF)}
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

      {auditOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={closeAudit}
        >
          <div
            role="dialog"
            aria-label="Have I Been Pwned check"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-bronze/30 bg-navy-800 p-6 shadow-2xl"
          >
            <h3 className="font-medium text-slate-100">
              Have I Been Pwned check
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Passwords are hashed locally with SHA-1 and only the first 5
              hash characters are sent to api.pwnedpasswords.com — the
              password itself and its full hash never leave this device.
            </p>
            {audit.total === 0 ? (
              <p className="mt-4 text-sm text-slate-400">
                No entries have passwords to check.
              </p>
            ) : (
              <>
                <div className="mt-4">
                  <div className="h-1.5 overflow-hidden rounded-full bg-navy-900">
                    <div
                      className="h-full rounded-full bg-bronze transition-all duration-300"
                      style={{
                        width: `${(audit.done / audit.total) * 100}%`,
                      }}
                    />
                  </div>
                  <p
                    className="mt-2 text-sm text-slate-300"
                    aria-live="polite"
                  >
                    {audit.done} / {audit.total} checked
                  </p>
                </div>
                {!audit.running && (
                  <p className="mt-3 text-sm text-slate-300">
                    {audit.pwned === 0
                      ? "No passwords found in breaches."
                      : `${audit.pwned} of ${audit.total} passwords found in breaches — entries are labelled "pwned" and highlighted.`}
                  </p>
                )}
                {audit.failed.length > 0 && (
                  <p className="mt-2 text-xs text-amber-300">
                    Check failed for: {audit.failed.join(", ")}
                  </p>
                )}
              </>
            )}
            <div className="mt-5 flex justify-end gap-2">
              {audit.running ? (
                <button
                  type="button"
                  onClick={closeAudit}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300"
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  onClick={closeAudit}
                  className="rounded-lg bg-bronze px-4 py-2 text-sm font-medium text-navy-900"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
