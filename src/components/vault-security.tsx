"use client";

import { useState } from "react";

import { VaultUnlockError } from "@/crypto/errors";
import { downloadKeyfile, serializeKeyfile } from "@/crypto/keyfile";
import type { Keyfile } from "@/crypto/keyfile";
import { encodeRecoveryKey } from "@/crypto/recovery";
import { PASSWORD_AUTOFILL_OFF } from "@/lib/autofill";
import type { VaultClient } from "@/lib/vault-client";
import type { PublicVaultData } from "@/lib/vault-public";
import { VaultRemoteError } from "@/lib/vault-remote";
import { PropertyValueInput } from "@/components/secret-input";

const inputCls =
  "w-full rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-bronze";
const labelCls = "block text-xs uppercase tracking-wider text-slate-500";

// Security modal: master-password change and keyfile re-export, both gated
// behind re-entering the current password.
export function VaultSecurity({
  session,
  saveWith,
  allowPasswordFillSave = false,
  onChanged,
  onClose,
}: {
  session: VaultClient;
  // Flushes pending edits (with save-time entry metadata) through `persist`.
  saveWith: (
    persist: (draft: PublicVaultData) => Promise<PublicVaultData>,
  ) => Promise<void>;
  allowPasswordFillSave?: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [exportPw, setExportPw] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [exported, setExported] = useState<Keyfile | null>(null);
  const [copied, setCopied] = useState(false);

  async function submitChange(e: React.FormEvent) {
    e.preventDefault();
    if (pwBusy || !curPw || !newPw) return;
    if (newPw !== confirmPw) {
      setPwMsg({ ok: false, text: "New passwords don't match." });
      return;
    }
    setPwBusy(true);
    setPwMsg(null);
    try {
      await session.call("verifyPassword", curPw);
      await saveWith((draft) => session.changePassword(newPw, draft));
      setPwMsg({ ok: true, text: "Password changed — vault re-encrypted." });
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
      await session.call("verifyPassword", exportPw);
      setExported(await session.exportKeyfile());
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-md rounded-xl border border-bronze/30 bg-navy-800 p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-slate-100">Security</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        {/* --- change master password --- */}
        <form onSubmit={submitChange} className="mt-5 border-t border-slate-700/60 pt-5">
          <h4 className="text-sm font-medium text-slate-200">
            Change master password
          </h4>
          <div className="mt-3 space-y-3">
            <div>
              <label className={labelCls}>Current password</label>
              <PropertyValueInput
                type="password"
                value={curPw}
                onValueChange={setCurPw}
                {...(allowPasswordFillSave
                  ? { autoComplete: "current-password" }
                  : PASSWORD_AUTOFILL_OFF)}
                className={`${inputCls} mt-1`}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>New password</label>
                <PropertyValueInput
                  type="password"
                  value={newPw}
                  onValueChange={setNewPw}
                  {...(allowPasswordFillSave
                    ? { autoComplete: "new-password" }
                    : PASSWORD_AUTOFILL_OFF)}
                  className={`${inputCls} mt-1`}
                />
              </div>
              <div>
                <label className={labelCls}>Confirm new</label>
                <PropertyValueInput
                  type="password"
                  value={confirmPw}
                  onValueChange={setConfirmPw}
                  {...(allowPasswordFillSave
                    ? { autoComplete: "new-password" }
                    : PASSWORD_AUTOFILL_OFF)}
                  className={`${inputCls} mt-1`}
                />
              </div>
            </div>
          </div>
          {pwMsg && (
            <p
              className={`mt-3 text-sm ${pwMsg.ok ? "text-emerald-300" : "text-red-300"}`}
            >
              {pwMsg.text}
            </p>
          )}
          <button
            type="submit"
            disabled={pwBusy || !curPw || !newPw || !confirmPw}
            className="mt-4 w-full rounded-lg bg-bronze px-4 py-2 text-sm font-medium text-navy-900 transition hover:bg-bronze-light disabled:opacity-50"
          >
            {pwBusy ? "Re-encrypting…" : "Change password"}
          </button>
        </form>

        {/* --- export keyfile / recovery code --- */}
        <div className="mt-6 border-t border-slate-700/60 pt-5">
          <h4 className="text-sm font-medium text-slate-200">
            Export keyfile & recovery code
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            For a new device: install the .key file there, or type the recovery
            code by hand. Keep both offline — either one plus your password
            opens the vault.
          </p>
          {!exported ? (
            <form onSubmit={submitExport} className="mt-3">
              <label className={labelCls}>
                Master password — required to reveal
              </label>
              <PropertyValueInput
                type="password"
                value={exportPw}
                onValueChange={setExportPw}
                {...(allowPasswordFillSave
                  ? { autoComplete: "current-password" }
                  : PASSWORD_AUTOFILL_OFF)}
                className={`${inputCls} mt-1`}
              />
              {exportErr && (
                <p className="mt-3 text-sm text-red-300">{exportErr}</p>
              )}
              <button
                type="submit"
                disabled={exportBusy || !exportPw}
                className="mt-3 w-full rounded-lg border border-bronze/60 px-4 py-2 text-sm font-medium text-bronze transition hover:bg-bronze/10 disabled:opacity-50"
              >
                {exportBusy ? "Verifying…" : "Reveal keyfile"}
              </button>
            </form>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-300">
                Key <span className="font-mono text-bronze">{exported.kid}</span>
              </p>
              <button
                type="button"
                onClick={() => downloadKeyfile(serializeKeyfile(exported))}
                className="w-full rounded-lg border border-bronze/60 px-4 py-2 text-sm font-medium text-bronze transition hover:bg-bronze/10"
              >
                Download portunus.key
              </button>
              <div>
                <label className={labelCls}>Recovery code</label>
                <code className="mt-1 block break-all rounded-lg border border-slate-700 bg-navy-900/60 px-3 py-2 font-mono text-xs leading-relaxed text-slate-200">
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
                  className="mt-1 text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
                >
                  {copied ? "Copied ✓" : "Copy code"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
