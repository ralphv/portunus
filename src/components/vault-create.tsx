"use client";

import { useState } from "react";

import type { Keyfile } from "@/crypto";
import {
  downloadKeyfile,
  encodeRecoveryKey,
  generateKeyfile,
  installKeyfile,
} from "@/crypto";
import { emptyVaultData, serializeVaultData } from "@/lib/vault-doc";
import { VaultRemoteError, VaultSession } from "@/lib/vault-session";

export function VaultCreate({
  onOpen,
}: {
  onOpen: (session: VaultSession, keyfile: Keyfile) => void;
}) {
  const [step, setStep] = useState<"password" | "keyfile">("password");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [generated, setGenerated] = useState<{
    keyfile: Keyfile;
    json: string;
  } | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [install, setInstall] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setGenerated(await generateKeyfile());
    setStep("keyfile");
  }

  async function finish() {
    if (!generated || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (install) installKeyfile(generated.keyfile);
      const session = await VaultSession.create(
        { password, keyfile: generated.keyfile.key },
        serializeVaultData(emptyVaultData()),
      );
      onOpen(session, generated.keyfile);
    } catch (e) {
      setError(
        e instanceof VaultRemoteError && e.status === 401
          ? "Session expired — sign out and sign in again."
          : "Could not create the vault on Drive. Try again.",
      );
      setBusy(false);
    }
  }

  if (step === "password") {
    return (
      <form
        onSubmit={submitPassword}
        className="mx-auto w-full max-w-md rounded-xl border border-bronze/30 bg-navy-800/60 p-8 shadow-2xl shadow-black/40 backdrop-blur"
      >
        <h2 className="text-lg font-medium text-slate-100">Create your vault</h2>
        <p className="mt-1 text-sm text-slate-400">
          No vault found in Drive. Pick a master password — it combines with a
          keyfile, and both are required to open the vault.
        </p>

        <label className="mt-5 block text-xs uppercase tracking-wider text-slate-500">
          Master password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="new-password"
          className="mt-1 w-full rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2.5 text-slate-100 outline-none focus:border-bronze"
        />
        <label className="mt-4 block text-xs uppercase tracking-wider text-slate-500">
          Confirm password
        </label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          className="mt-1 w-full rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2.5 text-slate-100 outline-none focus:border-bronze"
        />

        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

        <button
          type="submit"
          disabled={!password || !confirm}
          className="mt-6 w-full rounded-lg bg-bronze px-4 py-2.5 font-medium text-navy-900 transition hover:bg-bronze-light disabled:opacity-50"
        >
          Continue
        </button>
      </form>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-xl border border-bronze/30 bg-navy-800/60 p-8 shadow-2xl shadow-black/40 backdrop-blur">
      <h2 className="text-lg font-medium text-slate-100">Save your keyfile</h2>
      <p className="mt-1 text-sm text-slate-400">
        This key is required together with your password — losing it means the
        vault is unrecoverable. Download the file and keep the recovery code
        somewhere safe (print it, or store it in another password manager).
      </p>

      <label className="mt-5 block text-xs uppercase tracking-wider text-slate-500">
        Recovery code
      </label>
      <p className="mt-1 break-all rounded-lg border border-slate-700 bg-navy-900/60 px-3 py-2.5 font-mono text-xs leading-relaxed text-bronze">
        {generated ? encodeRecoveryKey(generated.keyfile.key) : "…"}
      </p>
      <button
        type="button"
        onClick={() =>
          generated &&
          void navigator.clipboard.writeText(
            encodeRecoveryKey(generated.keyfile.key),
          )
        }
        className="mt-1 text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
      >
        Copy code
      </button>

      <button
        type="button"
        onClick={() => {
          if (generated) downloadKeyfile(generated.json);
          setDownloaded(true);
        }}
        className="mt-5 w-full rounded-lg border border-bronze/60 px-4 py-2.5 font-medium text-bronze transition hover:bg-bronze/10"
      >
        {downloaded ? "portunus.key downloaded ✓" : "Download portunus.key"}
      </button>

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={install}
          onChange={(e) => setInstall(e.target.checked)}
          className="accent-bronze"
        />
        Also install the keyfile in this browser
      </label>
      <label className="mt-3 flex items-start gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 accent-bronze"
        />
        I have saved the keyfile and recovery code — I understand both are
        required and cannot be recovered if lost.
      </label>

      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

      <button
        type="button"
        onClick={finish}
        disabled={busy || !downloaded || !acknowledged}
        className="mt-6 w-full rounded-lg bg-bronze px-4 py-2.5 font-medium text-navy-900 transition hover:bg-bronze-light disabled:opacity-50"
      >
        {busy ? "Creating vault…" : "Create vault"}
      </button>
    </div>
  );
}
