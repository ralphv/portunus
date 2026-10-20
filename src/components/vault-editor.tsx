"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { PASSWORD_AUTOFILL_OFF } from "@/lib/autofill";
import { checkPasswordStrength } from "@/lib/password-strength";
import type { PasswordStrength } from "@/lib/password-strength";
import { checkPasswordPwned } from "@/lib/pwned-passwords";
import { generatePassword } from "@/lib/password-gen";
import {
  generateTotp,
  normalizeTotpSecret,
  parseTotp,
  TOTP_URGENT_SECONDS,
  totpSecondsRemaining,
} from "@/lib/totp";
import {
  applyPwnedCheck,
  entryHref,
  filterEntries,
  formatElapsed,
  newEntry,
  normalizeLabels,
} from "@/lib/vault-doc";
import type { VaultData, VaultEntry } from "@/lib/vault-doc";

const PWNED_CHECK_DEBOUNCE_MS = 800;
const STRENGTH_DEBOUNCE_MS = 250;

const inputCls =
  "w-full rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-bronze";
const passwordInputCls = `${inputCls} font-mono`;
const labelCls = "block text-xs uppercase tracking-wider text-slate-500";
const chipBaseCls =
  "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs";
const chipCls = `${chipBaseCls} border-bronze/40 bg-bronze/10 text-bronze`;
const pwnedChipCls =
  "inline-flex max-w-full items-center gap-1 rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-red-300";

const STRENGTH_LABELS = [
  "Very weak",
  "Weak",
  "Fair",
  "Strong",
  "Excellent",
];
const STRENGTH_COLORS = [
  "bg-red-500",
  "bg-red-400",
  "bg-amber-400",
  "bg-emerald-400",
  "bg-emerald-300",
];

// Thin 5-segment meter; fill follows zxcvbn's 0–4 score with a
// red → amber → emerald ramp.
function PasswordMeter({
  strength,
  checking,
}: {
  strength: PasswordStrength | null;
  checking: boolean;
}) {
  const filled = strength ? strength.score + 1 : 0;
  const color = strength ? STRENGTH_COLORS[strength.score] : "bg-slate-600";
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1" role="meter" aria-label="Password strength"
        aria-valuemin={0} aria-valuemax={5} aria-valuenow={filled}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i < filled ? color : "bg-slate-700"
            }`}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-400">
        {strength ? (
          <>
            <span className={strength.score <= 1 ? "text-red-300" : strength.score === 2 ? "text-amber-300" : "text-emerald-300"}>
              {STRENGTH_LABELS[strength.score]}
            </span>
            <span className="text-slate-500"> · {strength.crackTime} to crack</span>
            {strength.hint && (
              <span className="block text-slate-500">{strength.hint}</span>
            )}
          </>
        ) : (
          <span className="text-slate-500">
            {checking ? "scoring…" : ""}
          </span>
        )}
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "unknown"
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Defers work until the browser is idle so it never blocks rendering.
function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: 500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}

function useLabelSuggestions(entries: VaultEntry[]): string[] {
  const [labels, setLabels] = useState<string[]>([]);
  useEffect(
    () =>
      whenIdle(() => {
        const all = normalizeLabels(entries.flatMap((e) => e.labels));
        all.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        setLabels(all);
      }),
    [entries],
  );
  return labels;
}

// Ticks once a minute so elapsed times stay current while the vault is open.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function LabelEditor({
  labels,
  suggestions,
  readOnly,
  onChange,
}: {
  labels: string[];
  suggestions: string[];
  readOnly: boolean;
  onChange: (labels: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);

  function add(label: string) {
    onChange(normalizeLabels([...labels, label]));
    setInput("");
  }

  const q = input.trim().toLowerCase();
  const taken = new Set(labels.map((l) => l.toLowerCase()));
  const matches = q
    ? suggestions
        .filter((s) => !taken.has(s.toLowerCase()) && s.toLowerCase().includes(q))
        .slice(0, 8)
    : [];

  return (
    <div>
      <label className={labelCls}>Labels</label>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {labels.map((label) => (
          <span key={label} className={chipCls}>
            <span className="truncate">{label}</span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onChange(labels.filter((l) => l !== label))}
                aria-label={`Remove label ${label}`}
                className="text-bronze/70 hover:text-red-300"
              >
                ✕
              </button>
            )}
          </span>
        ))}
        {readOnly && labels.length === 0 && (
          <span className="text-xs text-slate-500">—</span>
        )}
      </div>
      {!readOnly && (
        <div
          className="relative mt-2"
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            // Focus moving to a suggestion stays inside; anywhere else
            // (e.g. Done) commits the typed label so it isn't lost.
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setFocused(false);
            if (input.trim()) add(input);
          }}
        >
          <input
            className={inputCls}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === ",") && input.trim()) {
                e.preventDefault();
                add(input);
              } else if (e.key === "Enter") {
                e.preventDefault();
              } else if (e.key === "Backspace" && !input && labels.length) {
                onChange(labels.slice(0, -1));
              }
            }}
            placeholder="Add label…"
            autoComplete="off"
            aria-label="Add label"
          />
          {focused && matches.length > 0 && (
            <ul
              role="listbox"
              className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-600 bg-navy-800 py-1 shadow-xl shadow-black/40"
            >
              {matches.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    // Keep focus in the input on mouse; click covers keyboard too.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(s)}
                    className="block w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-navy-700 hover:text-slate-100"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ItemHistory({
  entry,
  passwordPending,
  now,
  copied,
  copy,
  allowPasswordFillSave = false,
}: {
  entry: VaultEntry;
  passwordPending: boolean;
  now: number;
  copied: string | null;
  copy: (text: string, key: string) => void;
  allowPasswordFillSave?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [prevOpen, setPrevOpen] = useState(false);
  const [shown, setShown] = useState<Record<number, boolean>>({});
  const history = entry.passwordHistory;

  return (
    <div className="rounded-lg border border-slate-700/70 bg-navy-900/40 px-3 py-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`${labelCls} hover:text-slate-300`}
      >
        {open ? "▾" : "▸"} Item History
      </button>
      {passwordPending && (
        <p className="mt-2 text-xs text-amber-300">
          Password changed — history updates when you save.
        </p>
      )}
      {open && (
        <>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-slate-500">Created</dt>
            <dd className="text-slate-300">{formatDate(entry.createdAt)}</dd>
            <dt className="text-slate-500">Last password update</dt>
            <dd className="text-slate-300">
              {formatDate(entry.passwordUpdatedAt)}
              <span className="text-slate-500">
                {" "}
                ({formatElapsed(entry.passwordUpdatedAt, new Date(now))} ago)
              </span>
            </dd>
            <dt className="text-slate-500">Password updates</dt>
            <dd className="text-slate-300">{entry.passwordUpdateCount}</dd>
            {entry.pwnedCheck && (
              <>
                <dt className="text-slate-500">Breach check</dt>
                <dd
                  className={
                    entry.pwnedCheck.pwned
                      ? "text-red-300"
                      : "text-slate-300"
                  }
                >
                  {entry.pwnedCheck.pwned
                    ? `Found in breaches (${entry.pwnedCheck.count.toLocaleString()} sightings)`
                    : "Not found in known breaches"}
                  <span className="text-slate-500">
                    {" "}
                    · {formatDate(entry.pwnedCheck.checkedAt)}
                  </span>
                </dd>
              </>
            )}
          </dl>
          {history.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setPrevOpen((o) => !o)}
                aria-expanded={prevOpen}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                {prevOpen ? "▾" : "▸"} Previous Passwords ({history.length})
              </button>
              {prevOpen && (
                <ul className="mt-2 space-y-2">
                  {history.map((h, i) => (
                    <li key={`${h.replacedAt}-${i}`}>
                      <div className="flex gap-2">
                        <input
                          className={passwordInputCls}
                          type={shown[i] ? "text" : "password"}
                          value={h.password}
                          readOnly
                          {...(allowPasswordFillSave
                            ? {}
                            : PASSWORD_AUTOFILL_OFF)}
                          aria-label={`Previous password ${i + 1}`}
                        />
                        <button
                          type="button"
                          onClick={() => setShown((s) => ({ ...s, [i]: !s[i] }))}
                          className="shrink-0 rounded-lg border border-slate-600 px-3 text-xs text-slate-400 hover:text-slate-200"
                        >
                          {shown[i] ? "hide" : "show"}
                        </button>
                        <button
                          type="button"
                          onClick={() => copy(h.password, `h-${entry.id}-${i}`)}
                          className="shrink-0 rounded-lg border border-slate-600 px-3 text-xs text-slate-400 hover:text-slate-200"
                        >
                          {copied === `h-${entry.id}-${i}` ? "copied ✓" : "copy"}
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Replaced {formatDate(h.replacedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

type TotpState = {
  code: string;
  remaining: number;
  digits: number;
  period: number;
};

// Live TOTP code for an entry's stored otpauth URI, ticking on a short
// interval so the rollover lands within ~250ms. Null while the first
// code is being generated or when the stored secret can't be parsed.
function useTotp(uri: string | undefined): TotpState | null {
  const [state, setState] = useState<TotpState | null>(null);
  useEffect(() => {
    const params = uri ? parseTotp(uri) : null;
    let alive = true;
    const tick = async () => {
      if (!params) {
        if (alive) setState(null);
        return;
      }
      const now = Date.now();
      try {
        let code = await generateTotp(params, now);
        // Rollover mid-generate: regenerate once so the shown code and
        // the countdown both belong to the period on screen.
        const shownAt = Date.now();
        if (
          Math.floor(shownAt / 1000 / params.period) !==
          Math.floor(now / 1000 / params.period)
        ) {
          code = await generateTotp(params, shownAt);
        }
        if (alive) {
          setState({
            code,
            remaining: totpSecondsRemaining(params.period, shownAt),
            digits: params.digits,
            period: params.period,
          });
        }
      } catch {
        if (alive) setState(null);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 250);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [uri]);
  return state;
}

// 123456 → "123 456" for the common even widths; anything else as-is.
function formatTotpCode(code: string): string {
  if (code.length % 2 === 0 && code.length >= 4) {
    return `${code.slice(0, code.length / 2)} ${code.slice(code.length / 2)}`;
  }
  return code;
}

const totpBtnCls =
  "rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200";

// Live code + countdown; turns red in the last TOTP_URGENT_SECONDS.
function TotpCodeView({ totp, compact = false }: { totp: TotpState; compact?: boolean }) {
  const urgent = totp.remaining <= TOTP_URGENT_SECONDS;
  return (
    <span className="inline-flex items-baseline gap-2">
      <span
        className={`font-mono tracking-widest ${
          compact ? "text-sm" : "text-lg"
        } ${urgent ? "text-red-300" : "text-slate-100"}`}
        aria-label={`Two-factor code ${totp.code}`}
      >
        {formatTotpCode(totp.code)}
      </span>
      <span
        className={`text-xs tabular-nums ${
          urgent ? "text-red-300" : "text-slate-500"
        }`}
        aria-label={`${totp.remaining} seconds left`}
      >
        {totp.remaining}s
      </span>
    </span>
  );
}

function TotpCode({ uri, compact = false }: { uri: string; compact?: boolean }) {
  const totp = useTotp(uri);
  if (!totp) {
    return <span className="font-mono text-sm text-slate-500">——</span>;
  }
  return <TotpCodeView totp={totp} compact={compact} />;
}

// The entry's two-factor secret field: locked once a secret exists (an
// "edit" button is required to change it — no accidental keystrokes),
// fillable by pasting a secret/otpauth URI or by uploading a QR image.
function TotpField({
  entry,
  readOnly,
  copied,
  copy,
  allowPasswordFillSave,
  onSecretChange,
}: {
  entry: VaultEntry;
  readOnly: boolean;
  copied: string | null;
  copy: (text: string, key: string) => void;
  allowPasswordFillSave: boolean;
  onSecretChange: (uri: string | undefined) => void;
}) {
  const hasSecret = Boolean(entry.totpSecret);
  // Locked = secret set and not explicitly unlocked for editing. A
  // readOnly flip (offline) reverts to the locked code view instead of
  // stranding the field in a buttonless edit state.
  const [unlocked, setUnlocked] = useState(false);
  const editing = hasSecret ? unlocked && !readOnly : true;
  const [text, setText] = useState("");
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const copyKey = `t-${entry.id}`;

  function lock() {
    setUnlocked(false);
    setText("");
    setError(null);
    setShown(false);
  }

  function commit() {
    if (readOnly) return;
    const trimmed = text.trim();
    if (!trimmed) {
      // Only patch when there's actually a secret to clear — an empty
      // Set on an empty field would otherwise dirty the vault.
      if (hasSecret) onSecretChange(undefined);
      lock();
      return;
    }
    const uri = normalizeTotpSecret(trimmed);
    if (!uri) {
      setError("Not a valid TOTP secret or otpauth:// URI.");
      return;
    }
    if (uri !== entry.totpSecret) onSecretChange(uri);
    lock();
  }

  async function scanQr(file: File) {
    if (readOnly) return;
    setScanning(true);
    setError(null);
    try {
      const QrScanner = (await import("qr-scanner")).default;
      const result = await QrScanner.scanImage(file, {
        returnDetailedScanResult: true,
      });
      const uri = normalizeTotpSecret(result.data);
      if (!uri) {
        setError("That QR code isn't a TOTP secret (otpauth://).");
      } else {
        onSecretChange(uri);
        lock();
      }
    } catch {
      setError("No QR code found in that image.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div>
      <label className={labelCls}>Two-factor code</label>
      {hasSecret && !editing ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {entry.totpSecret && <TotpCode uri={entry.totpSecret} />}
          <button
            type="button"
            onClick={() => {
              const t = entry.totpSecret;
              if (!t) return;
              const params = parseTotp(t);
              if (!params) return;
              void generateTotp(params).then((c) => copy(c, copyKey));
            }}
            className={totpBtnCls}
          >
            {copied === copyKey ? "copied ✓" : "copy"}
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => {
                  setText(entry.totpSecret ?? "");
                  setUnlocked(true);
                }}
                className={totpBtnCls}
              >
                edit
              </button>
              <button
                type="button"
                onClick={() => onSecretChange(undefined)}
                className={`${totpBtnCls} hover:border-red-500/50 hover:text-red-300`}
              >
                remove
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="mt-1">
          <div className="flex gap-2">
            <input
              className={passwordInputCls}
              type={shown ? "text" : "password"}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
              }}
              placeholder="Paste secret or otpauth:// URI…"
              aria-label="Two-factor secret"
              aria-invalid={Boolean(error)}
              {...(allowPasswordFillSave ? {} : PASSWORD_AUTOFILL_OFF)}
              disabled={readOnly || scanning}
            />
            <button
              type="button"
              onClick={() => setShown((s) => !s)}
              className="shrink-0 rounded-lg border border-slate-600 px-3 text-xs text-slate-400 hover:text-slate-200"
            >
              {shown ? "hide" : "show"}
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            {!readOnly && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={scanning}
                className="rounded border border-bronze/50 px-2 py-1 text-xs text-bronze hover:bg-bronze/10"
              >
                {scanning ? "Scanning…" : "Scan QR image"}
              </button>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={commit}
                className={totpBtnCls}
                disabled={scanning}
              >
                {hasSecret ? "Done" : "Set"}
              </button>
            )}
          </div>
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
          {!error && (
            <p className="mt-2 text-xs text-slate-500">
              Paste a base32 secret or full otpauth:// URI, or scan the QR
              code image from your authenticator setup.
            </p>
          )}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void scanQr(f);
        }}
      />
    </div>
  );
}

// Collapsed row: one button that is itself the code display —
// "copy 2FA: 123 456 · 24s", red in the last TOTP_URGENT_SECONDS.
// Needs its own hook instance, so it can't live inside the map directly.
function CollapsedTotp({
  uri,
  id,
  copied,
  copy,
}: {
  uri: string;
  id: string;
  copied: string | null;
  copy: (text: string, key: string) => void;
}) {
  const totp = useTotp(uri);
  const key = `tc-${id}`;
  if (!totp) {
    return <span className="font-mono text-sm text-slate-500">——</span>;
  }
  const urgent = totp.remaining <= TOTP_URGENT_SECONDS;
  return (
    <button
      type="button"
      onClick={() => copy(totp.code, key)}
      className={totpBtnCls}
    >
      {copied === key ? "copied ✓ " : "copy 2FA: "}
      <span
        className={`font-mono tracking-wider ${
          urgent ? "text-red-300" : "text-slate-200"
        }`}
      >
        {formatTotpCode(totp.code)}
      </span>
      <span className={`tabular-nums ${urgent ? "text-red-300" : ""}`}>
        {" "}
        · {totp.remaining}s
      </span>
    </button>
  );
}

export function VaultEditor({
  data,
  saved,
  readOnly = false,
  hibpOnEdit = true,
  allowPasswordFillSave = false,
  onChange,
}: {
  data: VaultData; // current draft
  saved: VaultData; // last successfully loaded/saved snapshot
  readOnly?: boolean;
  // Silent Have-I-Been-Pwned re-checks on password edits — already
  // resolved by the caller (PORTUNUS_HIBP_ON_EDIT env flag AND the
  // vault's settings.checkPwnedOnEdit). The menu audit is unaffected.
  hibpOnEdit?: boolean;
  // settings.allowPasswordFillSave: when off, password inputs carry the
  // suppress attributes so the browser/OS stops offering to fill/save.
  allowPasswordFillSave?: boolean;
  onChange: (next: VaultData) => void;
}) {
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});
  const labelSuggestions = useLabelSuggestions(data.entries);
  const savedPasswords = useMemo(
    () => new Map(saved.entries.map((e) => [e.id, e.password])),
    [saved],
  );
  const now = useNow();

  // Refs so delayed/async checks (debounced pwned lookup, zxcvbn scoring)
  // always see the newest data and the current onChange, not the closure
  // they were scheduled from. Edit handlers must read entries from
  // dataRef too — the `data` prop lags `commit()` by one render, so a
  // handler built on it can clobber results committed in between (e.g.
  // an audit result dropped by the next keystroke).
  const dataRef = useRef(data);
  const onChangeRef = useRef(onChange);
  const readOnlyRef = useRef(readOnly);
  const hibpOnEditRef = useRef(hibpOnEdit);
  const pwnedTimers = useRef(new Map<string, number>());
  const pwPasted = useRef(new Set<string>());
  // Password-strength results cached by password value — scored in the
  // background as entries appear/change, so the meter is already filled
  // when an entry is opened. Entries sharing a password share a result.
  const [strengths, setStrengths] = useState<Map<string, PasswordStrength>>(
    () => new Map(),
  );
  const strengthInFlight = useRef(new Set<string>());

  useEffect(() => {
    dataRef.current = data;
    onChangeRef.current = onChange;
    readOnlyRef.current = readOnly;
    // Setting toggled off (or env flag flipped): cancel pending checks.
    if (hibpOnEditRef.current && !hibpOnEdit) {
      for (const t of pwnedTimers.current.values()) clearTimeout(t);
      pwnedTimers.current.clear();
    }
    hibpOnEditRef.current = hibpOnEdit;
  });

  useEffect(
    () => () => {
      for (const t of pwnedTimers.current.values()) clearTimeout(t);
    },
    [],
  );

  const commit = (next: VaultData) => {
    dataRef.current = next;
    onChangeRef.current(next);
  };

  function schedulePwnedCheck(id: string, password: string, delayMs: number) {
    if (readOnlyRef.current || !hibpOnEditRef.current || !password) return;
    const prev = pwnedTimers.current.get(id);
    if (prev !== undefined) clearTimeout(prev);
    pwnedTimers.current.set(
      id,
      window.setTimeout(() => {
        pwnedTimers.current.delete(id);
        void runPwnedCheck(id, password);
      }, delayMs),
    );
  }

  // A pending check fires immediately on blur — the user is done typing.
  function flushPwnedCheck(id: string) {
    const t = pwnedTimers.current.get(id);
    if (t === undefined) return;
    clearTimeout(t);
    pwnedTimers.current.delete(id);
    const entry = dataRef.current.entries.find((e) => e.id === id);
    if (entry?.password) void runPwnedCheck(id, entry.password);
  }

  // Silent post-edit check. Result is dropped if the password changed
  // again while the request was in flight.
  async function runPwnedCheck(id: string, password: string) {
    if (!hibpOnEditRef.current) return;
    try {
      const result = await checkPasswordPwned(password);
      const cur = dataRef.current.entries.find((e) => e.id === id);
      if (!cur || cur.password !== password) return;
      // Route through commit so dataRef updates synchronously — two
      // checks resolving in the same React batch must build on each
      // other, not on the same stale snapshot.
      commit({
        ...dataRef.current,
        entries: dataRef.current.entries.map((e) =>
          e.id === id
            ? applyPwnedCheck(e, {
                checkedAt: new Date().toISOString(),
                pwned: result.pwned,
                count: result.count,
              })
            : e,
        ),
      });
    } catch {
      // Offline or API error — the cleared state stays; nothing to
      // surface for a silent check.
    }
  }

  function patchEntry(id: string, patch: Partial<VaultEntry>) {
    const now = new Date().toISOString();
    commit({
      ...dataRef.current,
      entries: dataRef.current.entries.map((e) => {
        if (e.id !== id) return e;
        let updated: VaultEntry = {
          ...e,
          ...patch,
          updatedAt: now,
        };
        if (patch.password !== undefined && patch.password !== e.password) {
          // Password changed: stale check + "pwned" label clear right away;
          // a fresh check fires after typing stops (or at once on paste).
          updated = applyPwnedCheck(updated, undefined);
          schedulePwnedCheck(
            id,
            updated.password,
            pwPasted.current.delete(id) ? 0 : PWNED_CHECK_DEBOUNCE_MS,
          );
        }
        return updated;
      }),
    });
  }

  function addEntry() {
    const entry = newEntry();
    commit({
      ...dataRef.current,
      entries: [entry, ...dataRef.current.entries],
    });
    setOpenId(entry.id);
  }

  function removeEntry(id: string) {
    const entry = dataRef.current.entries.find((e) => e.id === id);
    if (!entry) return;
    if (!window.confirm(`Delete "${entry.name || "untitled"}"?`)) return;
    commit({
      ...dataRef.current,
      entries: dataRef.current.entries.filter((e) => e.id !== id),
    });
    if (openId === id) setOpenId(null);
  }

  function copy(text: string, key: string) {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  const isFiltered = (label: string) =>
    labelFilter.some((l) => l.toLowerCase() === label.toLowerCase());

  function toggleLabelFilter(label: string) {
    setLabelFilter((cur) =>
      isFiltered(label)
        ? cur.filter((l) => l.toLowerCase() !== label.toLowerCase())
        : [...cur, label],
    );
  }

  // Score every non-empty password once, shortly after it changes — the
  // lazy zxcvbn load + debounce happen here, not when the user opens an
  // entry.
  useEffect(() => {
    const pending = [
      ...new Set(
        data.entries
          .map((e) => e.password)
          .filter(
            (pw) =>
              pw && !strengths.has(pw) && !strengthInFlight.current.has(pw),
          ),
      ),
    ];
    if (!pending.length) return;
    const t = setTimeout(() => {
      void (async () => {
        for (const pw of pending) {
          strengthInFlight.current.add(pw);
          try {
            const s = await checkPasswordStrength(pw);
            setStrengths((cur) => new Map(cur).set(pw, s));
          } catch {
            // Scoring failure leaves the meter hidden; retried on next
            // data change.
          } finally {
            strengthInFlight.current.delete(pw);
          }
        }
      })();
    }, STRENGTH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [data.entries, strengths]);

  // Keep selected labels visible even if no entry carries them anymore.
  const filterChips = normalizeLabels([...labelSuggestions, ...labelFilter]);
  // The open entry stays visible so Add (blank entry) and edits that stop
  // matching the search/filter don't make the editor vanish.
  const matched = new Set(filterEntries(data.entries, search, labelFilter));
  const visible = data.entries.filter((e) => matched.has(e) || e.id === openId);

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entries…"
            autoFocus
            aria-describedby="entry-count"
            className={`${inputCls} pr-24`}
          />
          <span
            id="entry-count"
            aria-live="polite"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-500"
          >
            {visible.length} {visible.length === 1 ? "entry" : "entries"}
          </span>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={addEntry}
            className="shrink-0 rounded-lg border border-bronze/60 px-4 py-2 text-sm font-medium text-bronze transition hover:bg-bronze/10"
          >
            + Add
          </button>
        )}
      </div>

      {filterChips.length > 0 && (
        <div
          role="group"
          aria-label="Filter by label"
          className="mt-3 flex flex-wrap items-center gap-1.5"
        >
          {filterChips.map((label) => {
            const on = isFiltered(label);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => toggleLabelFilter(label)}
                className={`${chipBaseCls} transition ${
                  on
                    ? "border-bronze bg-bronze font-medium text-navy-900"
                    : "border-slate-600 bg-transparent text-slate-400 hover:border-bronze/60 hover:text-bronze"
                }`}
              >
                <span className="truncate">{label}</span>
              </button>
            );
          })}
          {labelFilter.length > 0 && (
            <button
              type="button"
              onClick={() => setLabelFilter([])}
              className="px-1 text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {visible.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-500">
          {data.entries.length === 0
            ? "Empty vault — add your first entry."
            : "No entries match your search."}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {visible.map((entry) => {
          const open = openId === entry.id;
          const href = entryHref(entry.url);
          const pwned = entry.pwnedCheck?.pwned === true;
          return (
            <li
              key={entry.id}
              className={`rounded-xl border bg-navy-800/60 ${
                pwned
                  ? "border-red-500/50 bg-red-500/[0.04]"
                  : "border-slate-700/70"
              }`}
            >
              <div className="relative flex items-center justify-between px-4 py-3">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : entry.id)}
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${entry.name || "Untitled"}`}
                  className="absolute inset-0 rounded-xl"
                />
                <div className="pointer-events-none relative min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-slate-100">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pointer-events-auto truncate underline decoration-slate-600 underline-offset-2 hover:text-bronze hover:decoration-bronze"
                      >
                        {entry.name || "Untitled"}
                      </a>
                    ) : (
                      <span className="truncate">
                        {entry.name || "Untitled"}
                      </span>
                    )}
                    {pwned && <span className={pwnedChipCls}>pwned</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {entry.username || entry.email || entry.url || "—"}
                  </p>
                  {!open && entry.labels.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {entry.labels.map((label) => (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={isFiltered(label)}
                          title={`Filter by ${label}`}
                          onClick={() => toggleLabelFilter(label)}
                          className={`${chipCls} pointer-events-auto hover:bg-bronze/20`}
                        >
                          <span className="truncate">{label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className="pointer-events-none relative ml-3 text-slate-500">
                  {open ? "▾" : "▸"}
                </span>
              </div>

              {!open &&
                (entry.username ||
                  entry.email ||
                  entry.password ||
                  entry.totpSecret) && (
                <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                  {entry.username && (
                    <button
                      type="button"
                      onClick={() => copy(entry.username, `u-${entry.id}`)}
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
                    >
                      {copied === `u-${entry.id}` ? "copied ✓" : "copy user"}
                    </button>
                  )}
                  {entry.email && (
                    <button
                      type="button"
                      onClick={() => copy(entry.email, `e-${entry.id}`)}
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
                    >
                      {copied === `e-${entry.id}` ? "copied ✓" : "copy email"}
                    </button>
                  )}
                  {entry.password && (
                    <button
                      type="button"
                      onClick={() => copy(entry.password, `p-${entry.id}`)}
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
                    >
                      {copied === `p-${entry.id}` ? "copied ✓" : "copy pass"}
                    </button>
                  )}
                  {entry.totpSecret && (
                    <CollapsedTotp
                      uri={entry.totpSecret}
                      id={entry.id}
                      copied={copied}
                      copy={copy}
                    />
                  )}
                </div>
              )}

              {open && (
                <div className="space-y-3 border-t border-slate-700/70 px-4 py-4">
                  <div>
                    <label className={labelCls}>Name</label>
                    <input
                      className={`${inputCls} mt-1`}
                      value={entry.name}
                      onChange={(e) => patchEntry(entry.id, { name: e.target.value })}
                      placeholder="example.com"
                      disabled={readOnly}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelCls}>Username</label>
                      <input
                        className={`${inputCls} mt-1`}
                        value={entry.username}
                        onChange={(e) =>
                          patchEntry(entry.id, { username: e.target.value })
                        }
                        autoComplete="off"
                        disabled={readOnly}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Password</label>
                      <div className="mt-1 flex gap-2">
                        <input
                          className={passwordInputCls}
                          type={showPw[entry.id] ? "text" : "password"}
                          value={entry.password}
                          onChange={(e) =>
                            patchEntry(entry.id, { password: e.target.value })
                          }
                          onPaste={() => pwPasted.current.add(entry.id)}
                          onBlur={() => flushPwnedCheck(entry.id)}
                          {...(allowPasswordFillSave
                            ? {}
                            : PASSWORD_AUTOFILL_OFF)}
                          disabled={readOnly}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowPw((s) => ({ ...s, [entry.id]: !s[entry.id] }))
                          }
                          className="shrink-0 rounded-lg border border-slate-600 px-3 text-xs text-slate-400 hover:text-slate-200"
                        >
                          {showPw[entry.id] ? "hide" : "show"}
                        </button>
                      </div>
                      {entry.password && open && (
                        <PasswordMeter
                          strength={strengths.get(entry.password) ?? null}
                          checking={!strengths.has(entry.password)}
                        />
                      )}
                      {entry.pwnedCheck?.pwned && (
                        <p className="mt-2 text-xs text-red-300">
                          Seen {entry.pwnedCheck.count.toLocaleString()} times
                          in breaches — change this password
                        </p>
                      )}
                      <div className="mt-2 flex gap-2">
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() =>
                              patchEntry(entry.id, { password: generatePassword() })
                            }
                            className="rounded border border-bronze/50 px-2 py-1 text-xs text-bronze hover:bg-bronze/10"
                          >
                            Generate
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => copy(entry.password, `p-${entry.id}`)}
                          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                        >
                          {copied === `p-${entry.id}` ? "copied ✓" : "copy"}
                        </button>
                      </div>
                    </div>
                  </div>
                  <TotpField
                    entry={entry}
                    readOnly={readOnly}
                    copied={copied}
                    copy={copy}
                    allowPasswordFillSave={allowPasswordFillSave}
                    onSecretChange={(uri) =>
                      patchEntry(entry.id, { totpSecret: uri })
                    }
                  />
                  <div>
                    <label className={labelCls}>Email</label>
                    <input
                      className={`${inputCls} mt-1`}
                      type="email"
                      value={entry.email}
                      onChange={(e) =>
                        patchEntry(entry.id, { email: e.target.value })
                      }
                      autoComplete="off"
                      disabled={readOnly}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>URL</label>
                    <input
                      className={`${inputCls} mt-1`}
                      value={entry.url}
                      onChange={(e) => patchEntry(entry.id, { url: e.target.value })}
                      placeholder="https://…"
                      autoComplete="off"
                      disabled={readOnly}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Notes</label>
                    <textarea
                      className={`${inputCls} mt-1 min-h-20`}
                      value={entry.notes}
                      onChange={(e) => patchEntry(entry.id, { notes: e.target.value })}
                      disabled={readOnly}
                    />
                  </div>
                  <LabelEditor
                    labels={entry.labels}
                    suggestions={labelSuggestions}
                    readOnly={readOnly}
                    onChange={(labels) => patchEntry(entry.id, { labels })}
                  />
                  <ItemHistory
                    key={entry.id}
                    entry={entry}
                    passwordPending={
                      savedPasswords.has(entry.id) &&
                      savedPasswords.get(entry.id) !== entry.password
                    }
                    now={now}
                    copied={copied}
                    copy={copy}
                    allowPasswordFillSave={allowPasswordFillSave}
                  />
                  <div className={`flex pt-1 ${readOnly ? "justify-end" : "justify-between"}`}>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => removeEntry(entry.id)}
                        className="rounded border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setOpenId(null)}
                      className="rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-600"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
