"use client";

import { useState } from "react";

import type { KdfTarget } from "@/crypto/kdf-upgrade";
import type { Keyfile } from "@/crypto/keyfile";
import {
  downloadKeyfile,
  generateKeyfile,
  installKeyfile,
} from "@/crypto/keyfile";
import { encodeRecoveryKey } from "@/crypto/recovery";
import {
  MASTER_PASSWORD_MIN_SCORE,
  MASTER_PASSWORD_USE_ANYWAY,
  MASTER_PASSWORD_WEAK_WARNING,
  PASSWORD_TOO_SHORT,
  PASSWORDS_DONT_MATCH,
} from "@/constants";
import { PASSWORD_AUTOFILL_OFF } from "@/lib/autofill";
import { VaultClient } from "@/lib/vault-client";
import type { UnlockedVault } from "@/lib/vault-client";
import { isVaultExists, VaultRemoteError } from "@/lib/vault-remote";
import type { VaultCachePolicy } from "@/lib/vault-remote";
import { PasswordStrengthMeter } from "@/components/password-strength-meter";
import { RevealablePasswordInput } from "@/components/secret-input";
import { usePasswordStrength } from "@/components/use-password-strength";

export function VaultCreate({
  cachePolicy,
  kdf,
  email,
  onOpen,
}: {
  cachePolicy: VaultCachePolicy;
  kdf: KdfTarget;
  // The signed-in account email, fed to zxcvbn so a password built from it
  // scores lower. Null when unknown.
  email: string | null;
  onOpen: (vault: UnlockedVault, keyfile: Keyfile) => void;
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
  // Set when the user has been warned about a weak password and may now
  // proceed anyway (soft-block — see MASTER_PASSWORD_MIN_SCORE).
  const [weakWarned, setWeakWarned] = useState(false);
  const { strength, checking } = usePasswordStrength(
    password,
    email ? [email] : [],
  );

  function onPasswordChange(value: string) {
    setPassword(value);
    // A fresh edit re-arms the soft-block warning.
    setWeakWarned(false);
  }

  async function proceed() {
    setError(null);
    setGenerated(await generateKeyfile());
    setStep("keyfile");
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError(PASSWORD_TOO_SHORT);
      return;
    }
    if (password !== confirm) {
      setError(PASSWORDS_DONT_MATCH);
      return;
    }
    // Soft-block: warn once on a weak password, then let the user continue.
    if (
      strength &&
      strength.score < MASTER_PASSWORD_MIN_SCORE &&
      !weakWarned
    ) {
      setError(MASTER_PASSWORD_WEAK_WARNING);
      setWeakWarned(true);
      return;
    }
    await proceed();
  }

  async function finish() {
    if (!generated || busy) return;
    setBusy(true);
    setError(null);
    try {
      const vault = await VaultClient.create(
        { password, keyfile: generated.keyfile.key },
        cachePolicy,
        kdf,
      );
      // Only after the vault exists: a refused create must not replace the
      // keyfile this device already holds for an existing vault.
      if (install) {
        try {
          installKeyfile(generated.keyfile);
        } catch {
          // localStorage unavailable — the downloaded keyfile still works.
        }
      }
      onOpen(vault, generated.keyfile);
    } catch (e) {
      setError(
        isVaultExists(e)
          ? "A vault already exists in your Drive. Reload the page to unlock it."
          : e instanceof VaultRemoteError && e.status === 401
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
        className="mx-auto w-full max-w-md rounded-[28px] bg-surface-container-low p-8 shadow-m3-1"
      >
        <h2 className="text-2xl leading-8 text-on-surface">Create your vault</h2>
        <p className="mt-1 text-sm text-on-surface-variant">
          No vault found in Drive. Pick a master password — it combines with a
          keyfile, and both are required to open the vault.
        </p>

        <label className="mt-5 block text-xs font-medium text-on-surface-variant">
          Master password
        </label>
        <RevealablePasswordInput
          value={password}
          onValueChange={onPasswordChange}
          autoFocus
          {...PASSWORD_AUTOFILL_OFF}
          className="w-full rounded-sm border border-outline bg-transparent px-3 py-2.5 text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
        {password && (
          <PasswordStrengthMeter strength={strength} checking={checking} />
        )}
        <label className="mt-4 block text-xs font-medium text-on-surface-variant">
          Confirm password
        </label>
        <RevealablePasswordInput
          value={confirm}
          onValueChange={setConfirm}
          {...PASSWORD_AUTOFILL_OFF}
          className="w-full rounded-sm border border-outline bg-transparent px-3 py-2.5 text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />

        {error && <p className="mt-4 text-sm text-error">{error}</p>}

        <button
          type="submit"
          disabled={!password || !confirm}
          className="mt-6 w-full rounded-full bg-primary px-4 py-2.5 font-medium text-on-primary transition hover:bg-primary/90 disabled:bg-on-surface/12 disabled:text-on-surface/38"
        >
          {weakWarned ? MASTER_PASSWORD_USE_ANYWAY : "Continue"}
        </button>
      </form>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-[28px] bg-surface-container-low p-8 shadow-m3-1">
      <h2 className="text-2xl leading-8 text-on-surface">Save your keyfile</h2>
      <p className="mt-1 text-sm text-on-surface-variant">
        This key is required together with your password — losing it means the
        vault is unrecoverable. Download the file and keep the recovery code
        somewhere safe (print it, or store it in another password manager).
      </p>

      <label className="mt-5 block text-xs font-medium text-on-surface-variant">
        Recovery code
      </label>
      <p className="mt-1 break-all rounded-lg border border-outline-variant bg-surface-container px-3 py-2.5 font-mono text-xs leading-relaxed text-primary">
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
        className="mt-1 text-xs text-on-surface-variant underline-offset-2 hover:text-on-surface hover:underline"
      >
        Copy code
      </button>

      <button
        type="button"
        onClick={() => {
          if (generated) downloadKeyfile(generated.json);
          setDownloaded(true);
        }}
        className="mt-5 w-full rounded-full border border-outline px-4 py-2.5 font-medium text-primary transition hover:bg-primary/8"
      >
        {downloaded ? "portunus.key downloaded ✓" : "Download portunus.key"}
      </button>

      <label className="mt-4 flex items-center gap-2 text-sm text-on-surface">
        <input
          type="checkbox"
          checked={install}
          onChange={(e) => setInstall(e.target.checked)}
          className="accent-primary"
        />
        Also install the keyfile in this browser
      </label>
      <label className="mt-3 flex items-start gap-2 text-sm text-on-surface">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 accent-primary"
        />
        I have saved the keyfile and recovery code — I understand both are
        required and cannot be recovered if lost.
      </label>

      {error && <p className="mt-4 text-sm text-error">{error}</p>}

      <button
        type="button"
        onClick={finish}
        disabled={busy || !downloaded || !acknowledged}
        className="mt-6 w-full rounded-full bg-primary px-4 py-2.5 font-medium text-on-primary transition hover:bg-primary/90 disabled:bg-on-surface/12 disabled:text-on-surface/38"
      >
        {busy ? "Creating vault…" : "Create vault"}
      </button>
    </div>
  );
}
