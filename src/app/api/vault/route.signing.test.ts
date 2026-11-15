import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  API_ERROR_PAYLOAD_TOO_LARGE,
  VAULT_PUT_BODY_MAX_BYTES,
  VAULT_WRAPPER_VERSION_BOUND,
  WRAPPER_SIGNATURE_CONTEXT_V3,
} from "@/constants";
import { MemoryStoreProvider } from "@/lib/store/providers/memory-store-provider";
import { signPayload, wrapSigned } from "@/lib/signing";
import { testSigningKey } from "@/lib/signing.test-helper";

// Signing is skipped in demo mode, so exercise the route against a plain
// in-memory store with demo mode off.
const storeRef = vi.hoisted(() => ({ current: null as MemoryStoreProvider | null }));
vi.mock("@/lib/store/get-store", () => ({
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
const createRaw = async (contents: string) =>
  store.createVault(await store.reserveVaultFileId(), contents);
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
    expect(wrapper.version).toBe(VAULT_WRAPPER_VERSION_BOUND);
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
    await createRaw(ENVELOPE);
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
      const file = await createRaw(ENVELOPE);
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

describe("/api/vault signature binding to the Drive file id", () => {
  it("creates the vault in one write, already signed for its own id", async () => {
    const reserve = vi.spyOn(store, "reserveVaultFileId");
    const update = vi.spyOn(store, "updateVault");
    const created = await (await put({ contents: ENVELOPE })).json();
    expect(created.fileId).toBe(await reserve.mock.results[0].value);
    expect(update).not.toHaveBeenCalled();
    expect((await get()).status).toBe(200);
  });

  it("writes nothing when the create fails", async () => {
    vi.spyOn(store, "createVault").mockRejectedValueOnce(
      new (await import("@/lib/store/store-interface")).StoreError(500, "boom"),
    );
    expect((await put({ contents: ENVELOPE })).status).toBe(502);
    expect(await store.findVaultFile()).toBeNull();
    // A retry creates normally.
    expect((await put({ contents: ENVELOPE })).status).toBe(200);
    expect((await get()).status).toBe(200);
  });

  it("re-signs for the assigned id if the store doesn't keep the reserved one", async () => {
    vi.spyOn(store, "reserveVaultFileId").mockResolvedValueOnce("memory-other-id");
    const real = store.createVault.bind(store);
    vi.spyOn(store, "createVault").mockImplementationOnce(async (_id, contents) =>
      real(`memory-${crypto.randomUUID()}`, contents),
    );
    expect((await put({ contents: ENVELOPE })).status).toBe(200);
    expect((await get()).status).toBe(200);
  });

  it("rejects a wrapper copied from another vault file", async () => {
    await put({ contents: ENVELOPE });
    const copied = await stored();
    const other = new MemoryStoreProvider();
    storeRef.current = other;
    await other.createVault(await other.reserveVaultFileId(), copied);
    const res = await GET(new Request("http://localhost/api/vault") as unknown as NextRequest);
    expect(res.status).toBe(422);
  });

  it("re-signs a legacy (unbound) signed vault in the current format on save", async () => {
    const legacy = wrapSigned(ENVELOPE, await signPayload(ENVELOPE));
    const file = await createRaw(legacy);
    expect((await get()).status).toBe(200);
    expect(JSON.parse(await stored())).not.toHaveProperty("version");
    expect((await put({ fileId: file.id, contents: ENVELOPE })).status).toBe(200);
    expect(JSON.parse(await stored()).version).toBe(VAULT_WRAPPER_VERSION_BOUND);
    expect((await get()).status).toBe(200);
  });

  it("refuses contents that start with a reserved domain tag", async () => {
    const res = await put({ contents: `${WRAPPER_SIGNATURE_CONTEXT_V3}{}` });
    expect(res.status).toBe(400);
  });
});

describe("/api/vault body size cap", () => {
  it("answers 413 for a declared Content-Length over the cap, before reading", async () => {
    const res = await PUT(
      new Request("http://localhost/api/vault", {
        method: "PUT",
        body: "{}",
        headers: { "content-length": String(VAULT_PUT_BODY_MAX_BYTES + 1) },
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: API_ERROR_PAYLOAD_TOO_LARGE });
    expect(await store.findVaultFile()).toBeNull();
  });

  it("answers 413 for an oversized streamed body without Content-Length", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x61);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent > VAULT_PUT_BODY_MAX_BYTES + chunk.length) return c.close();
        sent += chunk.length;
        c.enqueue(chunk);
      },
    });
    const res = await PUT(
      new Request("http://localhost/api/vault", {
        method: "PUT",
        body,
        duplex: "half",
      } as RequestInit) as unknown as NextRequest,
    );
    expect(res.status).toBe(413);
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
      await createRaw(JSON.stringify({ payload: ENVELOPE, signature: "bogus" }));
      const res = await get();
      expect(res.status).toBe(200);
      expect((await res.json()).contents).toBe(ENVELOPE);
    });
  },
);
