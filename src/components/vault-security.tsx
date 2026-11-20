"use client";

import { useState } from "react";

import { VaultUnlockError } from "@/crypto/errors";
import { downloadKeyfile, serializeKeyfile } from "@/crypto/keyfile";
import type { Keyfile } from "@/crypto/keyfile";
import { encodeRecoveryKey } from "@/crypto/recovery";
import {
  MASTER_PASSWORD_MIN_SCORE,
  MASTER_PASSWORD_USE_ANYWAY,
  MASTER_PASSWORD_WEAK_WARNING,
  NEW_PASSWORDS_DONT_MATCH,
} from "@/constants";
import { PASSWORD_AUTOFILL_OFF } from "@/lib/autofill";
import type { VaultClient } from "@/lib/vault-client";
import type { PublicVaultData } from "@/lib/vault-public";
import { VaultRemoteError } from "@/lib/vault-remote";
import { PasswordStrengthMeter } from "@/components/password-strength-meter";
import { RevealablePasswordInput } from "@/components/secret-input";
import { usePasswordStrength } from "@/components/use-password-strength";
import { VaultTwoFactor } from "@/components/vault-two-factor";
import { VaultBiometric } from "@/components/vault-biometric";
import type { DeviceUnlockRecord } from "@/crypto/device-unlock-record";
import type { BiometricInterface } from "@/lib/biometric/biometric-interface";
import { removeThisDevice } from "@/lib/biometric/device-unlock-flow";

const inputCls =
  "w-full rounded-sm border border-outline bg-transparent px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary";
const labelCls = "block text-xs font-medium text-on-surface-variant";

// Security modal: master-password change, keyfile re-export and the
// two-factor delivery gate, all gated behind re-entering the current password.
export function VaultSecurity({
  session,
  saveWith,
  allowPasswordFillSave = false,
  email,
  biometric,
  biometricKid,
  biometricRecord,
  onBiometricChanged,
  onChanged,
  onClose,
}: {
  session: VaultClient;
  // The signed-in account email, fed to zxcvbn when scoring the new password.
  email: string | null;
  // Flushes pending edits (with save-time entry metadata) through `persist`.
  saveWith: (
    persist: (draft: PublicVaultData) => Promise<PublicVaultData>,
  ) => Promise<void>;
  allowPasswordFillSave?: boolean;
  biometric: BiometricInterface;
  // Keyfile id when the keyfile is installed in this browser, else null.
  biometricKid: string | null;
  biometricRecord: DeviceUnlockRecord | null;
  onBiometricChanged: () => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Soft-block state for a weak new password (see MASTER_PASSWORD_MIN_SCORE).
  const [weakWarned, setWeakWarned] = useState(false);
  const { strength: newPwStrength, checking: newPwChecking } =
    usePasswordStrength(newPw, email ? [email] : []);

  function onNewPwChange(value: string) {
    setNewPw(value);
    setWeakWarned(false);
  }

  const [exportPw, setExportPw] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [exported, setExported] = useState<Keyfile | null>(null);
  const [copied, setCopied] = useState(false);
  const [biometricReset, setBiometricReset] = useState(false);

  async function submitChange(e: React.FormEvent) {
    e.preventDefault();
    if (pwBusy || !curPw || !newPw) return;
    if (newPw !== confirmPw) {
      setPwMsg({ ok: false, text: NEW_PASSWORDS_DONT_MATCH });
      return;
    }
    // Soft-block: warn once on a weak new password, then allow continuing.
    if (
      newPwStrength &&
      newPwStrength.score < MASTER_PASSWORD_MIN_SCORE &&
      !weakWarned
    ) {
      setPwMsg({ ok: false, text: MASTER_PASSWORD_WEAK_WARNING });
      setWeakWarned(true);
      return;
    }
    setPwBusy(true);
    setPwMsg(null);
    try {
      // The Worker checks curPw before re-encrypting (VaultUnlockError).
      await saveWith((draft) => session.changePassword(curPw, newPw, draft));
      setPwMsg({ ok: true, text: "Password changed — vault re-encrypted." });
      // The vault's data key changed, so this device's biometric record
      // (and every other device's) can't open it any more.
      if (biometricKid && biometricRecord) {
        await removeThisDevice(biometricKid, biometric);
        setBiometricReset(true);
        onBiometricChanged();
      }
      setCurPw("");
      setNewPw("");
      setConfirmPw("");
      onChanged();
    } catch (err) {
      if (err instanceof VaultUnlockError) {
        setPwMsg({ ok: false, text: "Current password is wrong." });
      } else if (err instanceof VaultRemoteError && err.status === 409) {
        setPwMsg({
          ok: false,
          text: "Vault changed elsewhere — lock and unlock to reload.",
        });
      } else {
        setPwMsg({ ok: false, text: "Password change failed. Try again." });
      }
    } finally {
      setPwBusy(false);
    }
  }

  async function submitExport(e: React.FormEvent) {
    e.preventDefault();
    if (exportBusy || !exportPw) return;
    setExportBusy(true);
    setExportErr(null);
    try {
      // The Worker checks the password before exporting (VaultUnlockError).
      setExported(await session.exportKeyfile(exportPw));
      setExportPw("");
    } catch (err) {
      setExportErr(
        err instanceof VaultUnlockError
          ? "Wrong password."
          : "Export failed. Try again.",
      );
    } finally {
      setExportBusy(false);
    }
  }

  return (
    // my-auto, not items-center: a centered flex child taller than the
    // viewport overflows above the scroll area, cutting off the header.
    <div
      className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-scrim/40 px-4 py-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Security"
        onClick={(e) => e.stopPropagation()}
        className="my-auto w-full max-w-md rounded-[28px] bg-surface-container-high p-6 shadow-m3-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-2xl leading-8 text-on-surface">Security</h3>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-on-surface/8"
          >
            ✕
          </button>
        </div>

        <VaultBiometric
          session={session}
          biometric={biometric}
          kid={biometricKid}
          record={biometricRecord}
          resetByPasswordChange={biometricReset}
          allowPasswordFillSave={allowPasswordFillSave}
          onChanged={() => {
            setBiometricReset(false);
            onBiometricChanged();
          }}
        />

        {/* --- change master password --- */}
        <form onSubmit={submitChange} className="mt-5 border-t border-outline-variant/60 pt-5">
          <h4 className="text-sm font-medium text-on-surface">
            Change master password
          </h4>
          <div className="mt-3 space-y-3">
            <div>
              <label className={labelCls}>Current password</label>
              <RevealablePasswordInput
                value={curPw}
                onValueChange={setCurPw}
                {...(allowPasswordFillSave
                  ? { autoComplete: "current-password" }
                  : PASSWORD_AUTOFILL_OFF)}
                className={inputCls}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>New password</label>
                <RevealablePasswordInput
                  value={newPw}
                  onValueChange={onNewPwChange}
                  {...(allowPasswordFillSave
                    ? { autoComplete: "new-password" }
                    : PASSWORD_AUTOFILL_OFF)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Confirm new</label>
                <RevealablePasswordInput
                  value={confirmPw}
                  onValueChange={setConfirmPw}
                  {...(allowPasswordFillSave
                    ? { autoComplete: "new-password" }
                    : PASSWORD_AUTOFILL_OFF)}
                  className={inputCls}
                />
              </div>
            </div>
            {newPw && (
              <PasswordStrengthMeter
                strength={newPwStrength}
                checking={newPwChecking}
              />
            )}
          </div>
          {pwMsg && (
            <p
              className={`mt-3 text-sm ${pwMsg.ok ? "text-success" : "text-error"}`}
            >
              {pwMsg.text}
            </p>
          )}
          <button
            type="submit"
            disabled={pwBusy || !curPw || !newPw || !confirmPw}
            className="mt-4 w-full rounded-full bg-primary px-4 py-2 text-sm font-medium text-on-primary transition hover:bg-primary/90 disabled:bg-on-surface/12 disabled:text-on-surface/38"
          >
            {pwBusy
              ? "Re-encrypting…"
              : weakWarned
                ? MASTER_PASSWORD_USE_ANYWAY
                : "Change password"}
          </button>
        </form>

        {/* --- export keyfile / recovery code --- */}
        <div className="mt-6 border-t border-outline-variant/60 pt-5">
          <h4 className="text-sm font-medium text-on-surface">
            Export keyfile & recovery code
          </h4>
          <p className="mt-1 text-xs text-on-surface-variant">
            For a new device: install the .key file there, or type the recovery
            code by hand. Keep both offline — either one plus your password
            opens the vault.
          </p>
          {!exported ? (
            <form onSubmit={submitExport} className="mt-3">
              <label className={labelCls}>
                Master password — required to reveal
              </label>
              <RevealablePasswordInput
                value={exportPw}
                onValueChange={setExportPw}
                {...(allowPasswordFillSave
                  ? { autoComplete: "current-password" }
                  : PASSWORD_AUTOFILL_OFF)}
                className={inputCls}
              />
              {exportErr && (
                <p className="mt-3 text-sm text-error">{exportErr}</p>
              )}
              <button
                type="submit"
                disabled={exportBusy || !exportPw}
                className="mt-3 w-full rounded-full border border-outline px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/8 disabled:border-on-surface/12 disabled:text-on-surface/38"
              >
                {exportBusy ? "Verifying…" : "Reveal keyfile"}
              </button>
            </form>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-on-surface">
                Key <span className="font-mono text-primary">{exported.kid}</span>
              </p>
              <button
                type="button"
                onClick={() => downloadKeyfile(serializeKeyfile(exported))}
                className="w-full rounded-full border border-outline px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/8"
              >
                Download portunus.key
              </button>
              <div>
                <label className={labelCls}>Recovery code</label>
                <code className="mt-1 block break-all rounded-lg border border-outline-variant bg-surface-container px-3 py-2 font-mono text-xs leading-relaxed text-on-surface">
                  {encodeRecoveryKey(exported.key)}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      encodeRecoveryKey(exported.key),
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="mt-1 text-xs text-on-surface-variant underline-offset-2 hover:text-on-surface hover:underline"
                >
                  {copied ? "Copied ✓" : "Copy code"}
                </button>
              </div>
            </div>
          )}
        </div>

        <VaultTwoFactor
          session={session}
          saveWith={saveWith}
          allowPasswordFillSave={allowPasswordFillSave}
          onChanged={onChanged}
        />
      </div>
    </div>
  );
}
