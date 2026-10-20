// TOTP (RFC 6238) generation + otpauth:// URI handling, all client-side.
// The secret never leaves the browser; codes are derived with WebCrypto
// HMAC so no crypto dependency is needed.
//
// Possible future change: if this ever needs more than RFC 6238 basics
// (Steam/custom alphabets, HOTP, deeper otpauth edge cases), the
// `otplib` package is the standard drop-in replacement — generation,
// URI parsing and keyuri helpers map onto the functions here, and the
// UI consumes only TotpParams/generateTotp so the swap stays local.

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export type TotpParams = {
  // Base32 secret, normalized: uppercase, no spaces/dashes/padding.
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  issuer: string;
  account: string;
};

export const TOTP_DEFAULTS = { algorithm: "SHA1", digits: 6, period: 30 } as const;
// A code near expiry is shown in red once this many seconds remain.
export const TOTP_URGENT_SECONDS = 5;

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// RFC 4648 base32 (uppercase, optional '=' padding). Whitespace and
// dashes are ignored; anything else returns null.
export function base32Decode(input: string): Uint8Array<ArrayBuffer> | null {
  const s = input.replace(/[\s-]/g, "").toUpperCase();
  // Charset check, and '=' padding may only appear at the end.
  if (!s || /[^A-Z2-7=]/.test(s) || !/^[^=]*={0,6}$/.test(s)) return null;
  const clean = s.replace(/=+$/, "");
  if (!clean) return null;
  let bits = 0;
  let value = 0;
  const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let idx = 0;
  for (const ch of clean) {
    const v = B32_ALPHABET.indexOf(ch);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out[idx++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out.subarray(0, idx);
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

function normalizeAlgorithm(v: string | null): TotpAlgorithm | null {
  if (v === null) return TOTP_DEFAULTS.algorithm;
  const a = v.toUpperCase();
  if (a === "SHA1" || a === "SHA256" || a === "SHA512") return a;
  return null;
}

function intParam(v: string | null, fallback: number, min: number, max: number): number | null {
  if (v === null) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || String(n) !== v || n < min || n > max) return null;
  return n;
}

// Accepts an otpauth://totp/… URI or a bare base32 secret and returns
// canonical params. Anything unparseable, missing the secret, or weaker
// than 80 bits of key material returns null.
export function parseTotp(input: string): TotpParams | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let rawSecret: string;
  let algorithm: TotpAlgorithm | null = TOTP_DEFAULTS.algorithm;
  let digits: number = TOTP_DEFAULTS.digits;
  let period: number = TOTP_DEFAULTS.period;
  let issuer = "";
  let account = "";

  if (/^otpauth:\/\/totp\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    rawSecret = url.searchParams.get("secret") ?? "";
    algorithm = normalizeAlgorithm(url.searchParams.get("algorithm"));
    if (!algorithm) return null;
    digits = intParam(url.searchParams.get("digits"), TOTP_DEFAULTS.digits, 6, 10) ?? 0;
    period = intParam(url.searchParams.get("period"), TOTP_DEFAULTS.period, 1, 3600) ?? 0;
    if (!digits || !period) return null;
    issuer = (url.searchParams.get("issuer") ?? "").trim();
    let label = "";
    try {
      label = decodeURIComponent(url.pathname.replace(/^\//, ""));
    } catch {
      // Malformed percent-encoding — treated as no label.
    }
    const sep = label.indexOf(":");
    if (sep >= 0) {
      if (!issuer) issuer = label.slice(0, sep).trim();
      account = label.slice(sep + 1).trim();
    } else {
      account = label.trim();
    }
  } else {
    rawSecret = trimmed;
  }

  const secret = rawSecret.replace(/[\s-]/g, "").toUpperCase().replace(/=+$/, "");
  const key = base32Decode(secret);
  // RFC 4226 §4: shared secrets should be at least 128 bits, 80 minimum.
  if (!key || key.length < 10) return null;

  return { secret, algorithm, digits, period, issuer, account };
}

// Canonical storage form: an otpauth:// URI, even for a bare secret, so
// digits/period/algorithm survive QR imports. Non-default params and a
// known issuer are spelled out explicitly.
export function totpUri(params: TotpParams): string {
  const label = params.issuer
    ? `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.account)}`
    : encodeURIComponent(params.account || "account");
  const q = new URLSearchParams({ secret: params.secret });
  if (params.issuer) q.set("issuer", params.issuer);
  if (params.algorithm !== TOTP_DEFAULTS.algorithm) q.set("algorithm", params.algorithm);
  if (params.digits !== TOTP_DEFAULTS.digits) q.set("digits", String(params.digits));
  if (params.period !== TOTP_DEFAULTS.period) q.set("period", String(params.period));
  return `otpauth://totp/${label}?${q.toString()}`;
}

// Parses user input and returns the canonical URI to store, or null.
export function normalizeTotpSecret(input: string): string | null {
  const params = parseTotp(input);
  return params ? totpUri(params) : null;
}

const HASH_BY_ALGO: Record<TotpAlgorithm, string> = {
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA512: "SHA-512",
};

// Time-based one-time password at `timeMs` (defaults to now).
export async function generateTotp(
  params: TotpParams,
  timeMs: number = Date.now(),
): Promise<string> {
  const keyBytes = base32Decode(params.secret);
  if (!keyBytes || keyBytes.length === 0) throw new Error("invalid TOTP secret");
  const counter = Math.floor(timeMs / 1000 / params.period);
  const msg = new Uint8Array(8);
  let n = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: HASH_BY_ALGO[params.algorithm] },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  // RFC 4226 dynamic truncation.
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  const mod = 10 ** params.digits;
  return String(binary % mod).padStart(params.digits, "0");
}

// Seconds until the current code rolls over.
export function totpSecondsRemaining(period: number, timeMs: number = Date.now()): number {
  return period - (Math.floor(timeMs / 1000) % period);
}
