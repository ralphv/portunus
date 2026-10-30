// Server-only (node:crypto): the two-factor gate on /api/vault delivery.
// When the signed vault wrapper carries a totp block, the payload is served
// only to a request holding a fresh grant cookie, which POST
// /api/vault/unlock mints for a valid RFC 6238 code. Offline Drive access
// is unaffected — this gates the app's delivery path, not the ciphertext.
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

import { LRUCache } from "lru-cache";

import { base32Decode, generateTotp, TOTP_DEFAULTS } from "./totp";
import type { VaultTotpBlock } from "./signing";

export const TOTP_GRANT_COOKIE = "portunus.vault-2fa";
// Sliding: every gated GET/PUT that passes re-issues the grant. Long enough
// to cover an unlocked session (auto-lock is skipped while edits are
// unsaved); locking clears it.
export const TOTP_GRANT_TTL_S = 12 * 60 * 60;
// Accept the previous, current and next 30s step (RFC 6238 §5.2).
const WINDOW = 1;
export const TOTP_MAX_FAILURES = 5;
export const TOTP_LOCKOUT_MS = 5 * 60 * 1000;

// 128–512 bits, canonical RFC 4648 base32 (uppercase, unpadded).
export function isValidTotpSecret(secret: string): boolean {
  if (!/^[A-Z2-7]+$/.test(secret)) return false;
  const bytes = base32Decode(secret);
  return bytes !== null && bytes.length >= 16 && bytes.length <= 64;
}

function fingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url").slice(0, 22);
}

type Failures = { count: number; since: number };
// Per-process state: last accepted step per (file, secret) blocks replays;
// failure counts per file throttle online guessing.
const lastUsedStep = new LRUCache<string, number>({ max: 10_000 });
const failures = new LRUCache<string, Failures>({ max: 10_000 });

export function resetTotpGateState(): void {
  lastUsedStep.clear();
  failures.clear();
}

export type TotpCheck = "ok" | "invalid" | "locked";

export async function verifyTotpCode(
  fileId: string,
  totp: VaultTotpBlock,
  code: string,
  nowMs: number = Date.now(),
): Promise<TotpCheck> {
  const f = failures.get(fileId);
  if (f && nowMs - f.since >= TOTP_LOCKOUT_MS) failures.delete(fileId);
  else if (f && f.count >= TOTP_MAX_FAILURES) return "locked";

  const digits = code.replace(/\s+/g, "");
  const replayKey = `${fileId}:${fingerprint(totp.secret)}`;
  const params = {
    ...TOTP_DEFAULTS,
    secret: totp.secret,
    issuer: "",
    account: "",
  };
  const period = TOTP_DEFAULTS.period;
  const step = Math.floor(nowMs / 1000 / period);
  let matched: number | null = null;
  if (/^\d{6}$/.test(digits)) {
    for (let d = -WINDOW; d <= WINDOW; d++) {
      const expected = await generateTotp(params, (step + d) * period * 1000);
      if (timingSafeEqual(Buffer.from(expected), Buffer.from(digits))) {
        matched = step + d;
      }
    }
  }
  const last = lastUsedStep.get(replayKey);
  if (matched === null || (last !== undefined && matched <= last)) {
    const prev = failures.get(fileId);
    failures.set(fileId, {
      count: (prev?.count ?? 0) + 1,
      since: prev?.since ?? nowMs,
    });
    return "invalid";
  }
  lastUsedStep.set(replayKey, matched);
  failures.delete(fileId);
  return "ok";
}

// HMAC key for grants: derived from AUTH_SECRET so grants survive restarts;
// a random per-process key otherwise (demo mode has no real secret).
let grantKey: { raw: string; key: Buffer } | null = null;
const processKey = randomBytes(32);
function getGrantKey(): Buffer {
  const raw = process.env.AUTH_SECRET ?? "";
  if (!raw) return processKey;
  if (grantKey?.raw !== raw) {
    grantKey = {
      raw,
      key: Buffer.from(hkdfSync("sha256", raw, "", "portunus vault 2fa grant", 32)),
    };
  }
  return grantKey.key;
}

function grantMac(fileId: string, totp: VaultTotpBlock, exp: number): string {
  return createHmac("sha256", getGrantKey())
    .update(`${fileId}\n${fingerprint(totp.secret)}\n${exp}`)
    .digest("base64url");
}

// Bound to the vault file and the current secret: re-enabling 2FA with a new
// secret, or another user's vault, invalidates it.
export function mintGrant(
  fileId: string,
  totp: VaultTotpBlock,
  nowMs: number = Date.now(),
): string {
  const exp = Math.floor(nowMs / 1000) + TOTP_GRANT_TTL_S;
  return `${exp}.${grantMac(fileId, totp, exp)}`;
}

export function checkGrant(
  grant: string | null,
  fileId: string,
  totp: VaultTotpBlock,
  nowMs: number = Date.now(),
): boolean {
  const m = grant?.match(/^(\d{1,12})\.([A-Za-z0-9_-]{43})$/);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp <= Math.floor(nowMs / 1000)) return false;
  const expected = Buffer.from(grantMac(fileId, totp, exp));
  const actual = Buffer.from(m[2]);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function readGrantCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === TOTP_GRANT_COOKIE) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

function isHttps(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  return proto === "https" || new URL(req.url).protocol === "https:";
}

function cookie(req: Request, value: string, maxAge: number): string {
  return [
    `${TOTP_GRANT_COOKIE}=${value}`,
    "Path=/api/vault",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(isHttps(req) ? ["Secure"] : []),
  ].join("; ");
}

export function grantCookie(
  req: Request,
  fileId: string,
  totp: VaultTotpBlock,
  nowMs: number = Date.now(),
): string {
  return cookie(req, mintGrant(fileId, totp, nowMs), TOTP_GRANT_TTL_S);
}

export function clearGrantCookie(req: Request): string {
  return cookie(req, "", 0);
}

export const totpRequired = () =>
  Response.json({ error: "totp_required" }, { status: 401 });

export function totpFailure(result: Exclude<TotpCheck, "ok">): Response {
  return result === "locked"
    ? Response.json({ error: "totp_locked" }, { status: 429 })
    : Response.json({ error: "totp_invalid" }, { status: 401 });
}
