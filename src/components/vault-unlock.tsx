"use client";

import { useRef, useState } from "react";

import {
  BIOMETRIC_OR_PASSWORD,
  BIOMETRIC_REMOVE_CONFIRM,
  BIOMETRIC_REMOVE_LABEL,
  BIOMETRIC_STALE_MESSAGE,
  BIOMETRIC_UNLOCK_FAILED_MESSAGE,
  BIOMETRIC_UNLOCK_LABEL,
  BIOMETRIC_WAITING_LABEL,
  ONSCREEN_KEYBOARD_KEY,
  ONSCREEN_KEYBOARD_OPEN,
  UNLOCK_FAILED_TWO_FACTOR_MESSAGE,
} from "@/constants";
import {
  DeviceUnlockError,
  DeviceUnlockStaleError,
  InvalidKeyfileError,
  VaultUnlockError,
} from "@/crypto/errors";
import type { Keyfile } from "@/crypto/keyfile";
import {
  installKeyfile,
  keyfileFromKey,
  parseKeyfile,
  uninstallKeyfile,
} from "@/crypto/keyfile";
import { decodeRecoveryKey } from "@/crypto/recovery";
import {
  PASSWORD_AUTOFILL_OFF,
  readPasswordFillSave,
} from "@/lib/autofill";
import { BiometricError } from "@/lib/biometric/biometric-error";
import { logBiometricFailure } from "@/lib/biometric/log-biometric-failure";
import type { BiometricInterface } from "@/lib/biometric/biometric-interface";
import {
  removeThisDevice,
  unlockWithThisDevice,
} from "@/lib/biometric/device-unlock-flow";
import { normalizeTotpCode } from "@/lib/totp";
import { VaultClient } from "@/lib/vault-client";
import type { UnlockedVault } from "@/lib/vault-client";
import type { RemoteVault } from "@/lib/vault-remote";
import {
  fetchRemoteVault,
  isTotpInvalid,
  isTotpRequired,
  isVaultSignatureInvalid,
  totpErrorMessage,
  unlockTotp,
  VAULT_SIGNATURE_INVALID_MESSAGE,
  VaultRemoteError,
} from "@/lib/vault-remote";
import type { VaultCachePolicy } from "@/lib/vault-remote";
import { OnScreenKeyboard } from "@/components/onscreen-keyboard";
import {
  PropertyValueInput,
  RevealablePasswordInput,
} from "@/components/secret-input";
import { useBiometricSupport, useDeviceRecord } from "@/components/use-biometric";

// Whether the on-screen keyboard is open, remembered per device. VaultUnlock
// only renders client-side, so reading storage in the initializer is safe.
function useOnScreenKeyboard(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(ONSCREEN_KEYBOARD_KEY) === ONSCREEN_KEYBOARD_OPEN;
    } catch {
      return false;
    }
  });
  function update(next: boolean) {
    setOpen(next);
    try {
      if (next) localStorage.setItem(ONSCREEN_KEYBOARD_KEY, ONSCREEN_KEYBOARD_OPEN);
      else localStorage.removeItem(ONSCREEN_KEYBOARD_KEY);
    } catch {
      // Storage unavailable — the choice still applies for this session.
    }
  }
  return [open, update];
}

export function VaultUnlock({
  keyfile,
  keyfileInstalled,
  totpRequired = false,
  cachePolicy,
  biometric,
  onKeyfile,
  onOpen,
  onNoVault,
}: {
  keyfile: Keyfile | null;
  keyfileInstalled: boolean;
  // The initial vault fetch already answered totp_required.
  totpRequired?: boolean;
  cachePolicy: VaultCachePolicy;
  // NOP provider when biometric unlock is off (PORTUNUS_BIOMETRIC_UNLOCK).
  biometric: BiometricInterface;
  onKeyfile: (kf: Keyfile | null, installed: boolean) => void;
  onOpen: (vault: UnlockedVault, keyfile: Keyfile) => void;
  onNoVault: () => void;
}) {
  const [password, setPassword] = useState("");
  const [keyboardOpen, setKeyboardOpen] = useOnScreenKeyboard();
  const passwordRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installAfterUnlock, setInstallAfterUnlock] = useState(true);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  // Set once the server answers totp_required: the vault's delivery is
  // gated behind a code from the user's authenticator app.
  const [totpNeeded, setTotpNeeded] = useState(totpRequired);
  const [totpCode, setTotpCode] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  // The delivered ciphertext, kept for password/keyfile retries — only
  // without two-factor, where every attempt must pass the code check again.
  const fetched = useRef<RemoteVault | null>(null);
  // Biometric unlock: offered when this device holds a record for the
  // installed keyfile.
  const { supported: biometricSupported } = useBiometricSupport(biometric);
  const [deviceRecord, refreshDeviceRecord] = useDeviceRecord(
    keyfile && keyfileInstalled ? keyfile.kid : null,
  );
  const biometricReady = biometricSupported && deviceRecord !== null;
  const [biometricBusy, setBiometricBusy] = useState(false);

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

  // The vault for one attempt. A two-factor vault spends a fresh code on
  // every attempt; otherwise one fetch is reused across retries.
  async function fetchForAttempt(twoFactor: boolean): Promise<RemoteVault | null> {
    let remote = twoFactor ? null : fetched.current;
    if (!remote) {
      if (twoFactor) {
        await unlockTotp(totpCode);
        setTotpCode("");
      }
      remote = await fetchRemoteVault(cachePolicy);
      if (remote && !twoFactor) fetched.current = remote;
    }
    return remote;
  }

  function totpCodeMissing(): boolean {
    if (totpNeeded && !/^\d{6}$/.test(totpCode)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return true;
    }
    return false;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyfile || !password || busy) return;
    if (totpCodeMissing()) return;
    setBusy(true);
    setError(null);
    // A two-factor vault re-checks the code on every attempt, and a failure
    // never says which of password, keyfile or code was wrong.
    const twoFactor = totpNeeded;
    try {
      const remote = await fetchForAttempt(twoFactor);
      if (!remote) {
        onNoVault();
        return;
      }
      const vault = await VaultClient.open(
        remote,
        { password, keyfile: keyfile.key },
        cachePolicy,
      );
      if (installAfterUnlock) {
        try {
          installKeyfile(keyfile);
          onKeyfile(keyfile, true);
        } catch {
          // localStorage unavailable — session-only keyfile still works.
        }
      }
      onOpen(vault, keyfile);
    } catch (err) {
      showUnlockError(err, twoFactor);
    } finally {
      setBusy(false);
    }
  }

  async function unlockWithBiometrics() {
    if (!keyfile || !deviceRecord || busy) return;
    if (totpCodeMissing()) return;
    setBusy(true);
    setBiometricBusy(true);
    setError(null);
    const twoFactor = totpNeeded;
    try {
      // The biometric check runs before the fetch, so cancelling it doesn't
      // spend a two-factor code.
      const vault = await unlockWithThisDevice(
        () => fetchForAttempt(twoFactor),
        deviceRecord,
        keyfile,
        biometric,
        cachePolicy,
      );
      if (!vault) {
        onNoVault();
        return;
      }
      onOpen(vault, keyfile);
    } catch (err) {
      if (err instanceof BiometricError) logBiometricFailure(err);
      if (err instanceof DeviceUnlockStaleError) {
        refreshDeviceRecord();
        setError(BIOMETRIC_STALE_MESSAGE);
      } else if (err instanceof BiometricError) {
        setError(BIOMETRIC_UNLOCK_FAILED_MESSAGE);
      } else if (err instanceof DeviceUnlockError && !twoFactor) {
        setError(BIOMETRIC_UNLOCK_FAILED_MESSAGE);
      } else {
        showUnlockError(err, twoFactor);
      }
    } finally {
      setBusy(false);
      setBiometricBusy(false);
    }
  }

  function showUnlockError(err: unknown, twoFactor: boolean) {
    if (isTotpRequired(err)) {
      fetched.current = null;
      setTotpNeeded(true);
      setTotpCode("");
      setError(twoFactor ? totpErrorMessage(err) : null);
    } else if (
      twoFactor &&
      (err instanceof VaultUnlockError ||
        err instanceof DeviceUnlockError ||
        isTotpInvalid(err))
    ) {
      setTotpCode("");
      setError(UNLOCK_FAILED_TWO_FACTOR_MESSAGE);
    } else if (totpErrorMessage(err)) {
      setTotpNeeded(true);
      setTotpCode("");
      setError(totpErrorMessage(err));
    } else if (err instanceof VaultUnlockError) {
      setError("Wrong password or keyfile.");
    } else if (isVaultSignatureInvalid(err)) {
      setError(VAULT_SIGNATURE_INVALID_MESSAGE);
    } else if (err instanceof VaultRemoteError && err.status === 401) {
      setError("Session expired — sign out and sign in again.");
    } else {
      setError("Unlock failed. Check your connection and try again.");
    }
  }

  async function removeBiometrics() {
    if (!keyfile || !window.confirm(BIOMETRIC_REMOVE_CONFIRM)) return;
    await removeThisDevice(keyfile.kid, biometric);
    refreshDeviceRecord();
    setError(null);
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto w-full max-w-md rounded-xl border border-bronze/30 bg-navy-800/60 p-5 shadow-2xl sm:p-8 shadow-black/40 backdrop-blur"
    >
      <h2 className="text-lg font-medium text-slate-100">Unlock vault</h2>

      {biometricReady && (
        <>
          <button
            type="button"
            onClick={() => void unlockWithBiometrics()}
            disabled={busy || (totpNeeded && !totpCode.trim())}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-bronze px-4 py-2.5 font-medium text-navy-900 transition hover:bg-bronze-light disabled:opacity-50"
          >
            <FingerprintIcon />
            {biometricBusy ? BIOMETRIC_WAITING_LABEL : BIOMETRIC_UNLOCK_LABEL}
          </button>
          <div className="mt-4 flex items-center gap-3 text-xs text-slate-500">
            <span className="h-px flex-1 bg-slate-700" />
            {BIOMETRIC_OR_PASSWORD}
            <span className="h-px flex-1 bg-slate-700" />
          </div>
        </>
      )}

      <label className="mt-5 block text-xs uppercase tracking-wider text-slate-500">
        Master password
      </label>
      <RevealablePasswordInput
        value={password}
        onValueChange={setPassword}
        autoFocus={!deviceRecord}
        aria-label="Master password"
        {...(keyfile && readPasswordFillSave(keyfile.kid)
          ? { autoComplete: "current-password" }
          : PASSWORD_AUTOFILL_OFF)}
        inputRef={passwordRef}
        keyboardOpen={keyboardOpen}
        onKeyboardToggle={() => setKeyboardOpen(!keyboardOpen)}
        className="w-full rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2.5 text-slate-100 outline-none focus:border-bronze"
      />
      {keyboardOpen && (
        <OnScreenKeyboard
          input={passwordRef}
          onValueChange={setPassword}
          onDone={() => setKeyboardOpen(false)}
        />
      )}

      {totpNeeded && (
        <>
          <label
            htmlFor="vault-totp-code"
            className="mt-5 block text-xs uppercase tracking-wider text-slate-500"
          >
            Two-factor code
          </label>
          <input
            id="vault-totp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            value={totpCode}
            onChange={(e) => setTotpCode(normalizeTotpCode(e.target.value))}
            placeholder="123456"
            className="mt-1 w-full rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2.5 font-mono tracking-widest text-slate-100 outline-none focus:border-bronze"
          />
          <p className="mt-1 text-xs text-slate-500">
            This vault requires the code from your authenticator app.
          </p>
        </>
      )}

      <hr className="mt-5 border-slate-700" />

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
          <PropertyValueInput
            type="text"
            value={recoveryCode}
            onValueChange={setRecoveryCode}
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
              void removeThisDevice(keyfile.kid, biometric);
              uninstallKeyfile();
              onKeyfile(null, false);
            }
          }}
          className="mt-2 text-xs text-slate-500 underline decoration-slate-600 underline-offset-2 hover:text-red-300"
        >
          Remove key from this browser
        </button>
      )}
      {biometricReady && (
        <button
          type="button"
          onClick={() => void removeBiometrics()}
          className="mt-2 block text-xs text-slate-500 underline decoration-slate-600 underline-offset-2 hover:text-red-300"
        >
          {BIOMETRIC_REMOVE_LABEL}
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
        disabled={busy || !keyfile || !password || (totpNeeded && !totpCode.trim())}
        className={
          biometricReady
            ? "mt-6 w-full rounded-lg border border-bronze/60 px-4 py-2.5 font-medium text-bronze transition hover:bg-bronze/10 disabled:opacity-50"
            : "mt-6 w-full rounded-lg bg-bronze px-4 py-2.5 font-medium text-navy-900 transition hover:bg-bronze-light disabled:opacity-50"
        }
      >
        {busy && !biometricBusy ? "Unlocking…" : "Unlock"}
      </button>
    </form>
  );
}

function FingerprintIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M12 11v3a8 8 0 0 1-1 4" />
      <path d="M8.5 9.5A4 4 0 0 1 16 11v1.5a12 12 0 0 1-.8 4.5" />
      <path d="M5.5 15a12 12 0 0 0 .5-3.5V11a6 6 0 0 1 10.5-4" />
      <path d="M18.5 9.5c.3.5.5 1 .5 1.5v1a16 16 0 0 1-.5 4" />
      <path d="M9 19.5a10 10 0 0 0 .8-2" />
      <path d="M4 7.5A10 10 0 0 1 17.5 4" />
    </svg>
  );
}
