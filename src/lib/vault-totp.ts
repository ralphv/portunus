// Server-only (node:crypto): the two-factor gate on /api/vault delivery.
// When the signed vault wrapper carries a totp block, POST /api/vault/unlock
// trades a valid RFC 6238 code for two grants: a short-lived, single-use
// delivery grant that GET /api/vault consumes (so every unlock needs a
// fresh code), and a sliding session grant that PUT /api/vault requires.
// Offline Drive access is unaffected — this gates the app's delivery path,
// not the ciphertext.
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

import { LRUCache } from "lru-cache";

import { base32Decode, generateTotp, TOTP_DEFAULTS } from "./totp";
import type { VaultTotpBlock } from "./signing";

export const TOTP_GRANT_COOKIE = "portunus.vault-2fa";
export const TOTP_DELIVERY_COOKIE = "portunus.vault-2fa-delivery";
// Covers the unlock round trip (code → GET) only.
export const TOTP_DELIVERY_TTL_S = 60;
// Session grant, sliding: every gated GET/PUT that passes re-issues it. Long enough
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
// Delivery grants already spent (until they expire anyway).
const usedDeliveryGrants = new LRUCache<string, true>({ max: 10_000 });

export function resetTotpGateState(): void {
  lastUsedStep.clear();
  failures.clear();
  usedDeliveryGrants.clear();
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

export type GrantPurpose = "session" | "delivery";

const GRANT_TTL_S: Record<GrantPurpose, number> = {
  session: TOTP_GRANT_TTL_S,
  delivery: TOTP_DELIVERY_TTL_S,
};

function grantMac(
  purpose: GrantPurpose,
  fileId: string,
  totp: VaultTotpBlock,
  exp: number,
): string {
  return createHmac("sha256", getGrantKey())
    .update(`${purpose}\n${fileId}\n${fingerprint(totp.secret)}\n${exp}`)
    .digest("base64url");
}

// Bound to the purpose, the vault file and the current secret: a session
// grant can't stand in for a delivery grant, and re-enabling 2FA with a new
// secret, or another user's vault, invalidates it.
export function mintGrant(
  fileId: string,
  totp: VaultTotpBlock,
  nowMs: number = Date.now(),
  purpose: GrantPurpose = "session",
): string {
  const exp = Math.floor(nowMs / 1000) + GRANT_TTL_S[purpose];
  return `${exp}.${grantMac(purpose, fileId, totp, exp)}`;
}

export function checkGrant(
  grant: string | null,
  fileId: string,
  totp: VaultTotpBlock,
  nowMs: number = Date.now(),
  purpose: GrantPurpose = "session",
): boolean {
  const m = grant?.match(/^(\d{1,12})\.([A-Za-z0-9_-]{43})$/);
  if (!m) return false;
  const exp = Number(m[1]);
  const now = Math.floor(nowMs / 1000);
  if (exp <= now || exp > now + GRANT_TTL_S[purpose]) return false;
  const expected = Buffer.from(grantMac(purpose, fileId, totp, exp));
  const actual = Buffer.from(m[2]);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Valid delivery grants work once; the GET that spends one also clears the
// cookie, and this per-process record refuses a replayed copy.
export function consumeDeliveryGrant(
  grant: string | null,
  fileId: string,
  totp: VaultTotpBlock,
  nowMs: number = Date.now(),
): boolean {
  if (!checkGrant(grant, fileId, totp, nowMs, "delivery")) return false;
  const key = `${fileId}:${grant}`;
  if (usedDeliveryGrants.has(key)) return false;
  usedDeliveryGrants.set(key, true, { ttl: (TOTP_DELIVERY_TTL_S + 1) * 1000 });
  return true;
}

export function readGrantCookie(
  req: Request,
  name: string = TOTP_GRANT_COOKIE,
): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

function isHttps(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  return proto === "https" || new URL(req.url).protocol === "https:";
}

function cookie(
  req: Request,
  value: string,
  maxAge: number,
  name: string = TOTP_GRANT_COOKIE,
): string {
  return [
    `${name}=${value}`,
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

export function deliveryCookie(
  req: Request,
  fileId: string,
  totp: VaultTotpBlock,
  nowMs: number = Date.now(),
): string {
  return cookie(
    req,
    mintGrant(fileId, totp, nowMs, "delivery"),
    TOTP_DELIVERY_TTL_S,
    TOTP_DELIVERY_COOKIE,
  );
}

export function clearDeliveryCookie(req: Request): string {
  return cookie(req, "", 0, TOTP_DELIVERY_COOKIE);
}

// Both grants, for lock / sign-out / disabling 2FA.
export function clearGrantCookies(req: Request): string[] {
  return [cookie(req, "", 0), clearDeliveryCookie(req)];
}

export const totpRequired = () =>
  Response.json({ error: "totp_required" }, { status: 401 });

export function totpFailure(result: Exclude<TotpCheck, "ok">): Response {
  return result === "locked"
    ? Response.json({ error: "totp_locked" }, { status: 429 })
    : Response.json({ error: "totp_invalid" }, { status: 401 });
}
