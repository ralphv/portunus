import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStoreProvider } from "@/lib/store/providers/memory-store-provider";
import { serializeStoredVault } from "@/lib/signing";
import { testSigningKey } from "@/lib/signing.test-helper";
import { generateTotp, TOTP_DEFAULTS } from "@/lib/totp";
import {
  resetTotpGateState,
  TOTP_DELIVERY_COOKIE,
  TOTP_GRANT_COOKIE,
} from "@/lib/vault-totp";

const storeRef = vi.hoisted(() => ({ current: null as MemoryStoreProvider | null }));
vi.mock("@/lib/store/get-store", () => ({
  getStore: async () => ({ store: storeRef.current }),
}));

import { GET, PUT } from "./route";
import { DELETE as LOCK, POST as UNLOCK } from "./unlock/route";

const ENVELOPE = JSON.stringify({ format: "portunus-vault", version: 1, ct: "abc" });
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
const code = (secret = SECRET, t = Date.now()) =>
  generateTotp({ ...TOTP_DEFAULTS, secret, issuer: "", account: "" }, t);

const req = (method: string, path: string, body?: unknown, cookie?: string) =>
  new Request(`http://localhost${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(cookie ? { headers: { cookie } } : {}),
  }) as unknown as NextRequest;
const get = (cookie?: string) => GET(req("GET", "/api/vault", undefined, cookie));
const put = (body: unknown, cookie?: string) => PUT(req("PUT", "/api/vault", body, cookie));
const unlock = (c: string, extra: Record<string, unknown> = {}) =>
  UNLOCK(req("POST", "/api/vault/unlock", { code: c, ...extra }));
const cookieOf = (res: Response, name: string) =>
  res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.split(";")[0];
// Session grant (saves) and single-use delivery grant (GET).
const grantOf = (res: Response) => cookieOf(res, TOTP_GRANT_COOKIE);
const deliveryOf = (res: Response) => cookieOf(res, TOTP_DELIVERY_COOKIE);

let store: MemoryStoreProvider;
let fileId: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  resetTotpGateState();
  store = new MemoryStoreProvider();
  storeRef.current = store;
  vi.stubEnv("PORTUNUS_DEMO_MODE", "");
  vi.stubEnv("PORTUNUS_SIGNATURES_DISABLED", "");
  vi.stubEnv("PORTUNUS_ALLOW_MISSING_SIGNATURE", "");
  vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", testSigningKey());
  vi.spyOn(console, "error").mockImplementation(() => {});
  fileId = (await store.createVault(await serializeStoredVault(ENVELOPE, { secret: SECRET }))).id;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/vault two-factor gate", () => {
  it("refuses delivery without a code", async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "totp_required" });
  });

  it("refuses a create without a grant that would shadow the 2FA vault", async () => {
    const res = await put({ contents: "impostor" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "vault_exists" });
    expect((await store.findVaultFile())?.id).toBe(fileId);
    expect((await get()).status).toBe(401); // still gated, not replaced
  });

  it("refuses a wrong code and a forged grant", async () => {
    const res = await unlock("000000" === (await code()) ? "111111" : "000000");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "totp_invalid" });
    expect(grantOf(res)).toBeUndefined();
    expect(deliveryOf(res)).toBeUndefined();

    const forged = await get(`${TOTP_DELIVERY_COOKIE}=${Math.floor(T0 / 1000) + 30}.${"A".repeat(22)}.${"A".repeat(43)}`);
    expect(forged.status).toBe(401);
    expect((await forged.json()).error).toBe("totp_required");
  });

  it("delivers contents after a valid code, accepting ±1 step", async () => {
    const prev = await code(SECRET, T0 - 30_000);
    const res = await unlock(prev);
    expect(res.status).toBe(200);
    const delivery = deliveryOf(res)!;
    for (const c of res.headers.getSetCookie()) expect(c).toMatch(/HttpOnly; SameSite=Strict/);

    const delivered = await get(delivery);
    expect(delivered.status).toBe(200);
    expect(await delivered.json()).toMatchObject({ contents: ENVELOPE, totpEnabled: true });
    expect(delivered.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(new RegExp(`^${TOTP_DELIVERY_COOKIE}=; .*Max-Age=0`)),
    );
    expect(grantOf(delivered)).toBeDefined();
  });

  it("asks for a fresh code on every delivery", async () => {
    const res = await unlock(await code());
    const delivery = deliveryOf(res)!;
    const session = grantOf(res)!;
    expect((await get(delivery)).status).toBe(200);
    // Spent: a reload (or a replayed cookie) must enter a new code.
    expect((await get(delivery)).status).toBe(401);
    // The session grant only covers saves, however fresh.
    expect((await get(session)).status).toBe(401);
    expect((await get(`${session}; ${delivery}`)).status).toBe(401);
    // Nor can a session grant's value pose as a delivery grant.
    const posed = session.replace(`${TOTP_GRANT_COOKIE}=`, `${TOTP_DELIVERY_COOKIE}=`);
    expect((await get(posed)).status).toBe(401);
  });

  it("gives each code its own delivery grant, even within one second", async () => {
    const a = deliveryOf(await unlock(await code(SECRET, T0 - 30_000)))!;
    const b = deliveryOf(await unlock(await code()))!;
    expect(a).not.toBe(b);
    expect((await get(a)).status).toBe(200);
    expect((await get(b)).status).toBe(200);
  });

  it("expires an unused delivery grant within a minute", async () => {
    const delivery = deliveryOf(await unlock(await code()))!;
    vi.setSystemTime(T0 + 61_000);
    expect((await get(delivery)).status).toBe(401);
  });

  it("skips the delivery grant for a save-time re-prompt, and clears both on lock", async () => {
    const res = await unlock(await code(), { deliver: false });
    expect(res.status).toBe(200);
    expect(deliveryOf(res)).toBeUndefined();
    expect((await put({ fileId, contents: ENVELOPE }, grantOf(res))).status).toBe(200);
    expect((await unlock("123456", { deliver: "no" })).status).toBe(400);

    const cleared = (await LOCK(req("DELETE", "/api/vault/unlock"))).headers.getSetCookie();
    expect(cleared).toHaveLength(2);
    for (const name of [TOTP_GRANT_COOKIE, TOTP_DELIVERY_COOKIE]) {
      expect(cleared).toContainEqual(expect.stringMatching(new RegExp(`^${name}=; .*Max-Age=0`)));
    }
  });

  it("rejects codes outside the window and replays", async () => {
    expect((await unlock(await code(SECRET, T0 - 90_000))).status).toBe(401);
    const c = await code();
    expect((await unlock(c)).status).toBe(200);
    expect((await unlock(c)).status).toBe(401);
  });

  it("locks out after repeated wrong codes", async () => {
    const bad = (await code()) === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await unlock(bad)).status).toBe(401);
    const res = await unlock(await code());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "totp_locked" });
    vi.setSystemTime(T0 + 5 * 60_000);
    expect((await unlock(await code())).status).toBe(200);
  });

  it("expires the grant and binds it to the current secret", async () => {
    const res = await unlock(await code());
    const grant = grantOf(res)!;
    const delivery = deliveryOf(res)!;
    vi.setSystemTime(T0 + 13 * 3600_000);
    expect((await put({ fileId, contents: ENVELOPE }, grant)).status).toBe(401);
    vi.setSystemTime(T0);
    await store.updateVault(
      fileId,
      await serializeStoredVault(ENVELOPE, { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" }),
    );
    expect((await put({ fileId, contents: ENVELOPE }, grant)).status).toBe(401);
    expect((await get(delivery)).status).toBe(401);
  });

  it("requires a grant to save, and keeps the block on ordinary saves", async () => {
    const res = await put({ fileId, contents: ENVELOPE });
    expect(res.status).toBe(401);
    const grant = grantOf(await unlock(await code()))!;
    expect((await put({ fileId, contents: ENVELOPE }, grant)).status).toBe(200);
    expect(JSON.parse(await store.downloadVault(fileId)).totp).toEqual({ secret: SECRET });
  });

  it("enables only with a valid code for the new secret, and disables", async () => {
    const grant = grantOf(await unlock(await code()))!;
    await put({ fileId, contents: ENVELOPE, totp: null }, grant);
    expect(JSON.parse(await store.downloadVault(fileId)).totp).toBeUndefined();
    expect((await get()).status).toBe(200);

    const next = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const wrong = await put({ fileId, contents: ENVELOPE, totp: { secret: next, code: await code() } });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error).toBe("totp_invalid");
    expect((await put({ fileId, contents: ENVELOPE, totp: { secret: "short", code: "123456" } })).status).toBe(400);

    const enabled = await put({ fileId, contents: ENVELOPE, totp: { secret: next, code: await code(next) } });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({ totpEnabled: true });
    expect((await get()).status).toBe(401);
    // Enabling grants saves for this session; delivery still needs a code.
    expect((await get(grantOf(enabled))).status).toBe(401);
    expect((await put({ fileId, contents: ENVELOPE }, grantOf(enabled))).status).toBe(200);
  });

  it("still rejects a tampered wrapper before the totp check", async () => {
    const w = JSON.parse(await store.downloadVault(fileId));
    delete w.totp;
    await store.updateVault(fileId, JSON.stringify(w));
    expect((await get()).status).toBe(422);
    expect((await unlock(await code())).status).toBe(422);
  });
});
