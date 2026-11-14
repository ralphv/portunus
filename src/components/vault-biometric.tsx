"use client";

import { useState } from "react";

import {
  BIOMETRIC_ENABLE_CANCELLED,
  BIOMETRIC_ENABLE_FAILED,
  BIOMETRIC_ENABLE_LABEL,
  BIOMETRIC_ENABLE_UNSUPPORTED,
  BIOMETRIC_ENABLED_SINCE,
  BIOMETRIC_NEEDS_KEYFILE,
  BIOMETRIC_PASSWORD_LABEL,
  BIOMETRIC_REMOVE_CONFIRM,
  BIOMETRIC_REMOVE_LABEL,
  BIOMETRIC_RESET_BY_PASSWORD,
  BIOMETRIC_SECTION_HELP,
  BIOMETRIC_SECTION_TITLE,
  BIOMETRIC_WAITING_LABEL,
  WRONG_PASSWORD_MESSAGE,
} from "@/constants";
import { logBiometricFailure } from "@/lib/biometric/log-biometric-failure";
import type { DeviceUnlockRecord } from "@/crypto/device-unlock-record";
import { VaultUnlockError } from "@/crypto/errors";
import { PASSWORD_AUTOFILL_OFF } from "@/lib/autofill";
import { BiometricError } from "@/lib/biometric/biometric-error";
import type { BiometricInterface } from "@/lib/biometric/biometric-interface";
import {
  enrollThisDevice,
  removeThisDevice,
} from "@/lib/biometric/device-unlock-flow";
import type { VaultClient } from "@/lib/vault-client";
import { RevealablePasswordInput } from "@/components/secret-input";
import { useBiometricSupport } from "@/components/use-biometric";

const inputCls =
  "w-full rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-bronze";
const labelCls = "block text-xs uppercase tracking-wider text-slate-500";

// Security dialog section: enable (master password + biometric check) or
// remove (no password) biometric unlock on this device. Hidden when the
// feature is off or this browser can't do it.
export function VaultBiometric({
  session,
  biometric,
  kid,
  record,
  resetByPasswordChange,
  allowPasswordFillSave,
  onChanged,
}: {
  session: VaultClient;
  biometric: BiometricInterface;
  // Keyfile id when the keyfile is installed in this browser, else null.
  kid: string | null;
  record: DeviceUnlockRecord | null;
  // A password change in this dialog just turned it off here.
  resetByPasswordChange: boolean;
  allowPasswordFillSave: boolean;
  onChanged: () => void;
}) {
  const { supported } = useBiometricSupport(biometric);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supported) return null;

  async function enable(e: React.FormEvent) {
    e.preventDefault();
    if (!kid || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await enrollThisDevice(session, biometric, password, kid);
      setPassword("");
      onChanged();
    } catch (err) {
      if (!(err instanceof VaultUnlockError)) logBiometricFailure(err);
      setError(
        err instanceof VaultUnlockError
          ? WRONG_PASSWORD_MESSAGE
          : err instanceof BiometricError && err.kind === "unsupported"
            ? BIOMETRIC_ENABLE_UNSUPPORTED
            : err instanceof BiometricError && err.kind === "cancelled"
              ? BIOMETRIC_ENABLE_CANCELLED
              : BIOMETRIC_ENABLE_FAILED,
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!kid || !window.confirm(BIOMETRIC_REMOVE_CONFIRM)) return;
    await removeThisDevice(kid, biometric);
    onChanged();
  }

  return (
    <section
      aria-label={BIOMETRIC_SECTION_TITLE}
      className="mt-5 border-t border-slate-700/60 pt-5"
    >
      <h4 className="text-sm font-medium text-slate-200">{BIOMETRIC_SECTION_TITLE}</h4>
      <p className="mt-1 text-xs text-slate-500">{BIOMETRIC_SECTION_HELP}</p>
      {!kid ? (
        <p className="mt-3 text-sm text-slate-400">{BIOMETRIC_NEEDS_KEYFILE}</p>
      ) : record ? (
        <div className="mt-3">
          <p className="text-sm text-emerald-300">
            {BIOMETRIC_ENABLED_SINCE}
            {new Date(record.createdAt).toLocaleDateString()}
          </p>
          <button
            type="button"
            onClick={() => void remove()}
            className="mt-3 w-full rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 transition hover:border-red-400/60 hover:text-red-300"
          >
            {BIOMETRIC_REMOVE_LABEL}
          </button>
        </div>
      ) : (
        <form onSubmit={enable} className="mt-3">
          {resetByPasswordChange && (
            <p className="mb-3 text-sm text-amber-300">{BIOMETRIC_RESET_BY_PASSWORD}</p>
          )}
          <label className={labelCls}>{BIOMETRIC_PASSWORD_LABEL}</label>
          <RevealablePasswordInput
            value={password}
            onValueChange={setPassword}
            {...(allowPasswordFillSave
              ? { autoComplete: "current-password" }
              : PASSWORD_AUTOFILL_OFF)}
            className={inputCls}
          />
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
          <button
            type="submit"
            disabled={busy || !password}
            className="mt-3 w-full rounded-lg bg-bronze px-4 py-2 text-sm font-medium text-navy-900 transition hover:bg-bronze-light disabled:opacity-50"
          >
            {busy ? BIOMETRIC_WAITING_LABEL : BIOMETRIC_ENABLE_LABEL}
          </button>
        </form>
      )}
    </section>
  );
}
