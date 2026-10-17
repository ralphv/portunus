"use client";

import { useEffect, useRef, useState } from "react";

import { AUTO_LOCK_IDLE_S } from "@/constants";
import { uninstallKeyfile, VaultUnlockError } from "@/crypto";
import { VaultRemoteError, VaultSession } from "@/lib/vault-session";
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
  offline,
  keyfileInstalled,
  onRemoveKeyfile,
  onLock,
}: {
  session: VaultSession;
  offline: boolean;
  keyfileInstalled: boolean;
  onRemoveKeyfile: () => void;
  onLock: () => void;
}) {
  const [version, setVersion] = useState(0); // bumped when session contents change
  const [saveOpen, setSaveOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [savePassword, setSavePassword] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const secondsLeft = useAutoLock(session.dirty, onLock);

  // Warn before the tab closes/reloads with unsaved changes.
  useEffect(() => {
    if (!session.dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [session.dirty]);

  function requestLock() {
    if (
      session.dirty &&
      !window.confirm("You have unsaved changes — lock anyway?")
    ) {
      return;
    }
    onLock();
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
      await session.save();
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
          {offline ? (
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
        <div className="flex gap-2">
          {!offline && (
            <>
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
              <button
                type="button"
                onClick={() => setSecurityOpen(true)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-400 hover:text-slate-100"
              >
                Security
              </button>
            </>
          )}
          {keyfileInstalled && (
            <button
              type="button"
              onClick={() => {
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
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-400 transition hover:border-red-500/50 hover:text-red-300"
            >
              Remove key
            </button>
          )}
          <button
            type="button"
            onClick={requestLock}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-400 hover:text-slate-100"
          >
            Lock
          </button>
        </div>
      </div>

      <VaultEditor
        session={session}
        readOnly={offline}
        onChanged={() => setVersion((v) => v + 1)}
      />
      <span className="hidden">{version}</span>

      {securityOpen && (
        <VaultSecurity
          session={session}
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
