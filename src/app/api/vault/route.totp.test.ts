import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStoreProvider } from "@/lib/store/providers/memory-store-provider";
import { serializeStoredVault } from "@/lib/signing";
import { testSigningKey } from "@/lib/signing.test-helper";
import { generateTotp, TOTP_DEFAULTS } from "@/lib/totp";
import { resetTotpGateState, TOTP_GRANT_COOKIE } from "@/lib/vault-totp";

const storeRef = vi.hoisted(() => ({ current: null as MemoryStoreProvider | null }));
vi.mock("@/factory", () => ({
  getStore: async () => ({ store: storeRef.current }),
}));

import { GET, PUT } from "./route";
import { POST as UNLOCK } from "./unlock/route";

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
const unlock = (c: string) => UNLOCK(req("POST", "/api/vault/unlock", { code: c }));
const grantOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${TOTP_GRANT_COOKIE}=`))
    ?.split(";")[0];

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

  it("refuses a wrong code and a forged grant", async () => {
    const res = await unlock("000000" === (await code()) ? "111111" : "000000");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "totp_invalid" });
    expect(grantOf(res)).toBeUndefined();

    const forged = await get(`${TOTP_GRANT_COOKIE}=9999999999.${"A".repeat(43)}`);
    expect(forged.status).toBe(401);
    expect((await forged.json()).error).toBe("totp_required");
  });

  it("delivers contents after a valid code, accepting ±1 step", async () => {
    const prev = await code(SECRET, T0 - 30_000);
    const res = await unlock(prev);
    expect(res.status).toBe(200);
    const grant = grantOf(res)!;
    expect(res.headers.getSetCookie()[0]).toMatch(/HttpOnly; SameSite=Strict/);

    const delivered = await get(grant);
    expect(delivered.status).toBe(200);
    expect(await delivered.json()).toMatchObject({ contents: ENVELOPE, totpEnabled: true });
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
    const grant = grantOf(await unlock(await code()))!;
    vi.setSystemTime(T0 + 13 * 3600_000);
    expect((await get(grant)).status).toBe(401);
    vi.setSystemTime(T0);
    await store.updateVault(
      fileId,
      await serializeStoredVault(ENVELOPE, { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" }),
    );
    expect((await get(grant)).status).toBe(401);
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
    expect((await get(grantOf(enabled))).status).toBe(200);
  });

  it("still rejects a tampered wrapper before the totp check", async () => {
    const w = JSON.parse(await store.downloadVault(fileId));
    delete w.totp;
    await store.updateVault(fileId, JSON.stringify(w));
    expect((await get()).status).toBe(422);
    expect((await unlock(await code())).status).toBe(422);
  });
});
