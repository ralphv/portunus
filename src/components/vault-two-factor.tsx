"use client";

import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";

import { VaultUnlockError } from "@/crypto/errors";
import { PASSWORD_AUTOFILL_OFF } from "@/lib/autofill";
import { base32Encode, totpUri, TOTP_DEFAULTS } from "@/lib/totp";
import type { VaultClient } from "@/lib/vault-client";
import type { PublicVaultData } from "@/lib/vault-public";
import { totpErrorMessage, VaultRemoteError } from "@/lib/vault-remote";
import { PropertyValueInput } from "@/components/secret-input";

const inputCls =
  "w-full rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-bronze";
const labelCls = "block text-xs uppercase tracking-wider text-slate-500";

// 20 random bytes (160 bits, RFC 4226's recommended length) as base32.
export function generateVaultTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export function vaultTotpUri(secret: string): string {
  return totpUri({ ...TOTP_DEFAULTS, secret, issuer: "Portunus", account: "user" });
}

// The QR as a single SVG path (no innerHTML, no data: URL — CSP-clean).
function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
      }
    }
    return { size: n + 8, path: d };
  }, [text]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Two-factor setup QR code"
      className="mx-auto h-48 w-48 rounded-lg bg-white"
      shapeRendering="crispEdges"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof VaultUnlockError) return "Wrong password.";
  if (err instanceof VaultRemoteError && err.status === 409) {
    return "Vault changed elsewhere — lock and unlock to reload.";
  }
  return totpErrorMessage(err) ?? fallback;
}

// Two-factor gate on vault delivery: the server only hands out the
// (encrypted) vault after a valid authenticator code. The secret lives in
// the server-signed Drive wrapper, not the encrypted document.
export function VaultTwoFactor({
  session,
  saveWith,
  allowPasswordFillSave,
  onChanged,
}: {
  session: VaultClient;
  saveWith: (
    persist: (draft: PublicVaultData) => Promise<PublicVaultData>,
  ) => Promise<void>;
  allowPasswordFillSave: boolean;
  onChanged: () => void;
}) {
  const [enabled, setEnabled] = useState(session.totpEnabled);
  const [pw, setPw] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pwProps = allowPasswordFillSave
    ? { autoComplete: "current-password" }
    : PASSWORD_AUTOFILL_OFF;

  async function run(fn: () => Promise<void>, fallback: string) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, fallback) });
    } finally {
      setBusy(false);
    }
  }

  const begin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw) return;
    void run(async () => {
      await session.call("verifyPassword", pw);
      setPw("");
      setSecret(generateVaultTotpSecret());
    }, "Couldn't start two-factor setup. Try again.");
  };

  const confirm = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = code.replace(/\s+/g, "");
    if (!secret || !/^\d{6}$/.test(digits)) {
      setMsg({ ok: false, text: "Enter the 6-digit code from your app." });
      return;
    }
    void run(async () => {
      await saveWith((draft) => session.saveTotp(draft, { secret, code: digits }));
      setSecret(null);
      setCode("");
      setEnabled(true);
      setMsg({ ok: true, text: "Two-factor authentication enabled." });
      onChanged();
    }, "Enabling two-factor failed. Try again.");
  };

  const disable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw) return;
    void run(async () => {
      await session.call("verifyPassword", pw);
      await saveWith((draft) => session.saveTotp(draft, null));
      setPw("");
      setEnabled(false);
      setMsg({ ok: true, text: "Two-factor authentication disabled." });
      onChanged();
    }, "Disabling two-factor failed. Try again.");
  };

  const message = msg && (
    <p className={`mt-3 text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>
      {msg.text}
    </p>
  );

  return (
    <div className="mt-6 border-t border-slate-700/60 pt-5">
      <h4 className="text-sm font-medium text-slate-200">
        {enabled ? "Disable 2FA" : "Enable two-factor authentication"}
      </h4>
      <p className="mt-1 text-xs text-slate-500">
        {enabled
          ? "The server asks for an authenticator code before sending your vault."
          : "Require an authenticator-app code before the server sends your vault. Protects this app's delivery only — anyone with your Drive file can still try to decrypt it offline."}
      </p>

      {session.offline ? (
        <p className="mt-3 text-sm text-slate-400">Unavailable while offline.</p>
      ) : enabled ? (
        <form onSubmit={disable} className="mt-3">
          <label className={labelCls}>Master password — required to disable</label>
          <PropertyValueInput
            type="password"
            value={pw}
            onValueChange={setPw}
            {...pwProps}
            className={`${inputCls} mt-1`}
          />
          {message}
          <button
            type="submit"
            disabled={busy || !pw}
            className="mt-3 w-full rounded-lg border border-red-400/60 px-4 py-2 text-sm font-medium text-red-300 transition hover:bg-red-400/10 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Disable 2FA"}
          </button>
        </form>
      ) : !secret ? (
        <form onSubmit={begin} className="mt-3">
          <label className={labelCls}>Master password — required to set up</label>
          <PropertyValueInput
            type="password"
            value={pw}
            onValueChange={setPw}
            {...pwProps}
            className={`${inputCls} mt-1`}
          />
          {message}
          <button
            type="submit"
            disabled={busy || !pw}
            className="mt-3 w-full rounded-lg border border-bronze/60 px-4 py-2 text-sm font-medium text-bronze transition hover:bg-bronze/10 disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Set up two-factor"}
          </button>
        </form>
      ) : (
        <form onSubmit={confirm} className="mt-3 space-y-3">
          <p className="text-xs text-slate-400">
            Scan with your authenticator app, or enter the key by hand.
          </p>
          <QrCode text={vaultTotpUri(secret)} />
          <div>
            <label className={labelCls}>Manual key</label>
            <code className="mt-1 block break-all rounded-lg border border-slate-700 bg-navy-900/60 px-3 py-2 font-mono text-xs tracking-wider text-slate-200">
              {secret.replace(/(.{4})/g, "$1 ").trim()}
            </code>
          </div>
          <div>
            <label htmlFor="vault-2fa-confirm" className={labelCls}>
              Code from your app
            </label>
            <input
              id="vault-2fa-confirm"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className={`${inputCls} mt-1 font-mono tracking-widest`}
            />
          </div>
          {message}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="flex-1 rounded-lg bg-bronze px-4 py-2 text-sm font-medium text-navy-900 transition hover:bg-bronze-light disabled:opacity-50"
            >
              {busy ? "Saving…" : "Enable"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setSecret(null);
                setCode("");
                setMsg(null);
              }}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
