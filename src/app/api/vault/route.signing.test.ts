import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStoreProvider } from "@/lib/store/providers/memory-store-provider";
import { testSigningKey } from "@/lib/signing.test-helper";

// Signing is skipped in demo mode, so exercise the route against a plain
// in-memory store with demo mode off.
const storeRef = vi.hoisted(() => ({ current: null as MemoryStoreProvider | null }));
vi.mock("@/factory", () => ({
  getStore: async () => ({ store: storeRef.current }),
}));

import { GET, PUT } from "./route";

const ENVELOPE = JSON.stringify({ format: "portunus-vault", version: 1, ct: "abc" });

const put = (body: unknown) =>
  PUT(
    new Request("http://localhost/api/vault", {
      method: "PUT",
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );
const get = () => GET(new Request("http://localhost/api/vault") as unknown as NextRequest);

let store: MemoryStoreProvider;
const stored = async () => store.downloadVault((await store.findVaultFile())!.id);
const overwrite = async (contents: string) =>
  store.updateVault((await store.findVaultFile())!.id, contents);

beforeEach(() => {
  store = new MemoryStoreProvider();
  storeRef.current = store;
  vi.stubEnv("PORTUNUS_DEMO_MODE", "");
  vi.stubEnv("PORTUNUS_SIGNATURES_DISABLED", "");
  vi.stubEnv("PORTUNUS_ALLOW_MISSING_SIGNATURE", "");
  vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", testSigningKey());
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/vault with signatures enabled", () => {
  it("stores a signed wrapper and returns only the payload", async () => {
    const created = await (await put({ contents: ENVELOPE })).json();
    const wrapper = JSON.parse(await stored());
    expect(wrapper.payload).toBe(ENVELOPE);
    expect(typeof wrapper.signature).toBe("string");

    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      fileId: created.fileId,
      modifiedTime: expect.any(String),
      contents: ENVELOPE,
    });
  });

  it("rejects a tampered payload with 422 and no contents", async () => {
    await put({ contents: ENVELOPE });
    const wrapper = JSON.parse(await stored());
    await overwrite(JSON.stringify({ ...wrapper, payload: ENVELOPE.replace("abc", "abd") }));

    const res = await get();
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "vault_signature_invalid" });
  });

  it("rejects a legacy unsigned envelope without the migration flag", async () => {
    await store.createVault(ENVELOPE);
    const res = await get();
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "vault_signature_invalid" });
  });

  it("rejects a wrapper whose signature was stripped", async () => {
    await put({ contents: ENVELOPE });
    await overwrite(JSON.stringify({ payload: ENVELOPE }));
    expect((await get()).status).toBe(422);
  });

  describe("with PORTUNUS_ALLOW_MISSING_SIGNATURE=1", () => {
    beforeEach(() => vi.stubEnv("PORTUNUS_ALLOW_MISSING_SIGNATURE", "1"));

    it("accepts a legacy envelope and signs it on the next save", async () => {
      const file = await store.createVault(ENVELOPE);
      const res = await get();
      expect(res.status).toBe(200);
      expect((await res.json()).contents).toBe(ENVELOPE);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("accepted unsigned vault"),
      );

      await put({ fileId: file.id, contents: ENVELOPE });
      expect(JSON.parse(await stored()).payload).toBe(ENVELOPE);
      vi.stubEnv("PORTUNUS_ALLOW_MISSING_SIGNATURE", "");
      expect((await get()).status).toBe(200);
    });

    it("still rejects an invalid signature", async () => {
      await put({ contents: ENVELOPE });
      const wrapper = JSON.parse(await stored());
      await overwrite(JSON.stringify({ ...wrapper, payload: ENVELOPE.replace("abc", "abd") }));
      const res = await get();
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "vault_signature_invalid" });
    });
  });
});

describe.each(["PORTUNUS_SIGNATURES_DISABLED", "PORTUNUS_DEMO_MODE"])(
  "/api/vault with %s=1",
  (flag) => {
    beforeEach(() => {
      vi.stubEnv(flag, "1");
      vi.stubEnv("PORTUNUS_SIGNING_PRIVATE_KEY", "");
    });

    it("stores and returns the bare envelope", async () => {
      await put({ contents: ENVELOPE });
      expect(await stored()).toBe(ENVELOPE);
      expect((await (await get()).json()).contents).toBe(ENVELOPE);
    });

    it("unwraps a previously signed file without verifying it", async () => {
      await store.createVault(JSON.stringify({ payload: ENVELOPE, signature: "bogus" }));
      const res = await get();
      expect(res.status).toBe(200);
      expect((await res.json()).contents).toBe(ENVELOPE);
    });
  },
);
