import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeviceUnlockStaleError } from "@/crypto/errors";
import { b64encode, generatePrfSalt, keyfileFromKey } from "@/crypto";
import type { DeviceUnlockRecord } from "@/crypto";
import { MemoryStoreProvider } from "@/lib/store/providers/memory-store-provider";
import { testSigningKey } from "@/lib/signing.test-helper";
import { generateTotp, TOTP_DEFAULTS } from "@/lib/totp";
import { makeSecrets } from "@/lib/vault-api-stub.test-helper";
import { newPublicEntry } from "@/lib/vault-public";
import type { PublicVaultData } from "@/lib/vault-public";
import { fetchRemoteVault, unlockTotp } from "@/lib/vault-remote";
import { resetTotpGateState } from "@/lib/vault-totp";
import { VaultWorkerCore } from "@/lib/vault-worker-core";

// Biometric unlock against a SIGNED vault. Each device's record is bound to
// a digest of the vault header; the server's Ed25519 signature (new on every
// save) and its two-factor block live in the wrapper around the envelope and
// must never reach that digest, or every save would make every device's
// record stale. Demo mode and the other client tests store bare envelopes,
// so they can't catch that — this runs the real vault code against the real
// /api/vault route with signing on.

const storeRef = vi.hoisted(() => ({ current: null as MemoryStoreProvider | null }));
vi.mock("@/lib/store/get-store", () => ({
  getStore: async () => ({ store: storeRef.current }),
}));

import { DELETE as LOCK, POST as UNLOCK } from "./unlock/route";
import { GET, PUT } from "./route";

const PASSWORD = "master";
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
const code = () =>
  generateTotp({ ...TOTP_DEFAULTS, secret: SECRET, issuer: "", account: "" }, Date.now());
// Each TOTP code is accepted once per 30 s step: move to the next one.
const nextStep = () => vi.setSystemTime(Date.now() + 30_000);

// The browser side's fetch, routed to the real handlers with a cookie jar
// (the two-factor grant cookies).
const jar = new Map<string, string>();
function keepCookies(res: Response): Response {
  for (const c of res.headers.getSetCookie()) {
    const [pair, ...attrs] = c.split(";");
    const [name, value] = pair.split("=");
    const expired = attrs.some((a) => /^\s*max-age=0$/i.test(a)) || value === "";
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), value);
  }
  return res;
}
async function routedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const path = String(input);
  const method = init.method ?? "GET";
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const req = new Request(`http://localhost${path}`, {
    method,
    body: init.body,
    headers: cookie ? { cookie } : {},
  }) as unknown as NextRequest;
  if (path === "/api/vault") {
    return keepCookies(await (method === "PUT" ? PUT(req) : GET(req)));
  }
  if (path === "/api/vault/unlock") {
    return keepCookies(await (method === "POST" ? UNLOCK(req) : LOCK(req)));
  }
  throw new Error(`unexpected fetch ${method} ${path}`);
}

let store: MemoryStoreProvider;
const storedWrapper = async () =>
  JSON.parse(await store.downloadVault((await store.findVaultFile())!.id)) as Record<
    string,
    unknown
  >;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  resetTotpGateState();
  jar.clear();
  store = new MemoryStoreProvider();
  storeRef.current = store;
  vi.stubEnv("PORTUNUS_DEMO_MODE", "");
  vi.stubEnv("PORTUNUS_SIGNATURES_DISABLED", "");
  vi.stubEnv("PORTUNUS_ALLOW_MISSING_SIGNATURE", "");
  vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", testSigningKey());
  vi.stubGlobal("fetch", vi.fn(routedFetch));
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CACHE_OFF = { offlineCache: false } as const;

// A signed vault with one entry, enrolled for biometric unlock.
async function enrolledSignedVault() {
  const secrets = await makeSecrets(PASSWORD);
  const core = new VaultWorkerCore();
  let draft: PublicVaultData = (await core.create(secrets)).data;
  draft = (
    await core.save({ ...draft, entries: [{ ...newPublicEntry(), name: "site" }] })
  ).data;
  const prf = crypto.getRandomValues(new Uint8Array(32));
  const { kid } = await keyfileFromKey(secrets.keyfile);
  const record: DeviceUnlockRecord = await core.enrollDevice(PASSWORD, prf.slice(), {
    kid,
    credentialId: b64encode(crypto.getRandomValues(new Uint8Array(16))),
    prfSalt: generatePrfSalt(),
  });
  // What another page load on this device does: fetch through the route,
  // then open with the record instead of the password.
  const openWithDevice = async () => {
    const remote = (await fetchRemoteVault(CACHE_OFF))!;
    return new VaultWorkerCore().openWithDevice(remote, record, prf.slice(), secrets.keyfile);
  };
  return { core, draft, openWithDevice };
}

describe("biometric unlock on a signed vault", () => {
  it("keeps working across saves, each with a new signature", async () => {
    const { core, draft, openWithDevice } = await enrolledSignedVault();
    const signatures = new Set<unknown>();
    let d = draft;
    for (let i = 0; i < 3; i++) {
      d = (await core.save({ ...d, entries: [{ ...d.entries[0], name: `site ${i}` }] })).data;
      const wrapper = await storedWrapper();
      expect(typeof wrapper.signature).toBe("string");
      signatures.add(wrapper.signature);
      const { data } = await openWithDevice();
      expect(data.entries[0].name).toBe(`site ${i}`);
    }
    expect(signatures.size).toBe(3);
  });

  it("gives the browser the bare envelope, never the signed wrapper", async () => {
    await enrolledSignedVault();
    const remote = (await fetchRemoteVault(CACHE_OFF))!;
    const envelope = JSON.parse(remote.contents) as Record<string, unknown>;
    expect(envelope.format).toBe("portunus-vault");
    expect(envelope).not.toHaveProperty("signature");
    expect(envelope).not.toHaveProperty("payload");
    expect(envelope).not.toHaveProperty("totp");
  });

  it("keeps working while two-factor is turned on and off", async () => {
    const { core, draft, openWithDevice } = await enrolledSignedVault();
    // On: the wrapper gains a signed totp block.
    await core.saveTotp(draft, { secret: SECRET, code: await code() });
    expect(await storedWrapper()).toHaveProperty("totp");
    nextStep();
    await unlockTotp(await code()); // delivery grant for the next GET
    expect((await openWithDevice()).data.entries[0].name).toBe("site");
    // Off: the block is gone again.
    await core.saveTotp(draft, null);
    expect(await storedWrapper()).not.toHaveProperty("totp");
    expect((await openWithDevice()).data.entries[0].name).toBe("site");
  });

  it("goes stale on a master password change (control)", async () => {
    const { core, draft, openWithDevice } = await enrolledSignedVault();
    await core.changePassword("new master", draft);
    await expect(openWithDevice()).rejects.toBeInstanceOf(DeviceUnlockStaleError);
  });
});
