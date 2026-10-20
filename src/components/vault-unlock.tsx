"use client";

import { useRef, useState } from "react";

import type { Keyfile } from "@/crypto";
import {
  decodeRecoveryKey,
  installKeyfile,
  InvalidKeyfileError,
  keyfileFromKey,
  parseKeyfile,
  uninstallKeyfile,
  VaultUnlockError,
} from "@/crypto";
import {
  PASSWORD_AUTOFILL_OFF,
  readPasswordFillSave,
} from "@/lib/autofill";
import { VaultRemoteError, VaultSession } from "@/lib/vault-session";

export function VaultUnlock({
  keyfile,
  keyfileInstalled,
  onKeyfile,
  onOpen,
  onNoVault,
}: {
  keyfile: Keyfile | null;
  keyfileInstalled: boolean;
  onKeyfile: (kf: Keyfile | null, installed: boolean) => void;
  onOpen: (session: VaultSession, keyfile: Keyfile) => void;
  onNoVault: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installAfterUnlock, setInstallAfterUnlock] = useState(true);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function useRecoveryCode() {
    try {
      const key = decodeRecoveryKey(recoveryCode);
      onKeyfile(await keyfileFromKey(key), false);
      setRecoveryCode("");
      setShowRecovery(false);
      setError(null);
    } catch {
      setError("Invalid recovery code.");
    }
  }

  async function pickKeyfile(file: File) {
    try {
      onKeyfile(await parseKeyfile(await file.text()), false);
      setError(null);
    } catch (e) {
      setError(
        e instanceof InvalidKeyfileError
          ? "That file is not a valid portunus.key."
          : "Could not read the keyfile.",
      );
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyfile || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await VaultSession.unlock({
        password,
        keyfile: keyfile.key,
      });
      if (!session) {
        onNoVault();
        return;
      }
      if (installAfterUnlock) {
        try {
          installKeyfile(keyfile);
          onKeyfile(keyfile, true);
        } catch {
          // localStorage unavailable — session-only keyfile still works.
        }
      }
      onOpen(session, keyfile);
    } catch (err) {
      if (err instanceof VaultUnlockError) {
        setError("Wrong password or keyfile.");
      } else if (err instanceof VaultRemoteError && err.status === 401) {
        setError("Session expired — sign out and sign in again.");
      } else {
        setError("Unlock failed. Check your connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto w-full max-w-md rounded-xl border border-bronze/30 bg-navy-800/60 p-8 shadow-2xl shadow-black/40 backdrop-blur"
    >
      <h2 className="text-lg font-medium text-slate-100">Unlock vault</h2>

      <label className="mt-5 block text-xs uppercase tracking-wider text-slate-500">
        Master password
      </label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
        {...(readPasswordFillSave()
          ? { autoComplete: "current-password" }
          : PASSWORD_AUTOFILL_OFF)}
        className="mt-1 w-full rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2.5 text-slate-100 outline-none focus:border-bronze"
      />

      <label className="mt-5 block text-xs uppercase tracking-wider text-slate-500">
        Keyfile
      </label>
      {keyfile ? (
        <p className="mt-1 rounded-lg border border-slate-700 bg-navy-900/60 px-3 py-2.5 text-sm text-slate-300">
          Key <span className="font-mono text-bronze">{keyfile.kid}</span>{" "}
          loaded
        </p>
      ) : (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="mt-1 w-full rounded-lg border border-dashed border-slate-600 px-3 py-2.5 text-sm text-slate-400 transition hover:border-bronze hover:text-slate-200"
        >
          Choose portunus.key…
        </button>
      )}
      {!keyfile && !showRecovery && (
        <button
          type="button"
          onClick={() => setShowRecovery(true)}
          className="mt-2 text-xs text-slate-500 underline decoration-slate-600 underline-offset-2 hover:text-bronze"
        >
          Restore from recovery code instead
        </button>
      )}
      {!keyfile && showRecovery && (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            placeholder="XXXXX-XXXXX-…"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-bronze"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={useRecoveryCode}
              disabled={!recoveryCode.trim()}
              className="rounded-lg border border-bronze/60 px-3 py-1.5 text-xs text-bronze hover:bg-bronze/10 disabled:opacity-40"
            >
              Use recovery code
            </button>
            <button
              type="button"
              onClick={() => {
                setShowRecovery(false);
                setRecoveryCode("");
              }}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".key,.json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pickKeyfile(f);
          e.target.value = "";
        }}
      />
      {keyfile && keyfileInstalled && (
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
              onKeyfile(null, false);
            }
          }}
          className="mt-2 text-xs text-slate-500 underline decoration-slate-600 underline-offset-2 hover:text-red-300"
        >
          Remove key from this browser
        </button>
      )}
      {keyfile && !keyfileInstalled && (
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={installAfterUnlock}
            onChange={(e) => setInstallAfterUnlock(e.target.checked)}
            className="accent-bronze"
          />
          Install this keyfile in this browser
        </label>
      )}

      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

      <button
        type="submit"
        disabled={busy || !keyfile || !password}
        className="mt-6 w-full rounded-lg bg-bronze px-4 py-2.5 font-medium text-navy-900 transition hover:bg-bronze-light disabled:opacity-50"
      >
        {busy ? "Unlocking…" : "Unlock"}
      </button>
    </form>
  );
}
