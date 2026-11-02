import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DRIVE_BAD_RESPONSE_MESSAGE,
  DRIVE_BAD_RESPONSE_STATUS,
  DRIVE_FOLDER_MIME,
  VAULT_FILENAME,
  VAULT_FOLDER_NAME,
} from "@/constants";

import { StoreError } from "../store-interface";
import { GoogleDriveStoreProvider } from "./google-drive-store-provider";
import { runStoreContract } from "../store-contract.test-helper";
import { createFakeDrive } from "../fake-drive.test-helper";

const TOKEN = "ya29.test-token";
const store = new GoogleDriveStoreProvider(TOKEN);

type Call = { url: string; init?: RequestInit };
const calls: Call[] = [];

function stubFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
}

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("findVaultFile", () => {
  it("returns the newest matching file", async () => {
    stubFetch(async () =>
      Response.json({
        files: [{ id: "f1", modifiedTime: "t1" }],
      }),
    );
    const meta = await store.findVaultFile();
    expect(meta).toEqual({ id: "f1", modifiedTime: "t1" });
    const url = decodeURIComponent(calls[0].url);
    expect(url).toContain(`name='${VAULT_FILENAME}'`);
    expect(url).toContain("trashed=false");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    });
  });

  it("returns null when no vault exists", async () => {
    stubFetch(async () => Response.json({ files: [] }));
    expect(await store.findVaultFile()).toBeNull();
  });

  it("throws StoreError with the upstream status", async () => {
    stubFetch(async () => new Response("denied", { status: 403 }));
    await expect(store.findVaultFile()).rejects.toMatchObject({
      name: "StoreError",
      status: 403,
    });
  });
});

describe("downloadVault", () => {
  it("fetches with alt=media and returns the body", async () => {
    stubFetch(async () => new Response('{"cipher":"text"}'));
    expect(await store.downloadVault("f1")).toBe('{"cipher":"text"}');
    expect(calls[0].url).toContain("/files/f1");
    expect(calls[0].url).toContain("alt=media");
  });
});

describe("findOrCreateVaultFolder", () => {
  it("returns the existing folder id", async () => {
    stubFetch(async () => Response.json({ files: [{ id: "folder-1" }] }));
    expect(await store.findOrCreateVaultFolder()).toBe("folder-1");
    const url = decodeURIComponent(calls[0].url);
    expect(url).toContain(`name='${VAULT_FOLDER_NAME}'`);
    expect(url).toContain(`mimeType='${DRIVE_FOLDER_MIME}'`);
  });

  it("creates the folder when absent", async () => {
    stubFetch(async (url, init) => {
      if (init?.method === "POST") {
        expect(init.body).toContain(`"mimeType":"${DRIVE_FOLDER_MIME}"`);
        expect(init.body).toContain(`"name":"${VAULT_FOLDER_NAME}"`);
        return Response.json({ id: "folder-new" });
      }
      return Response.json({ files: [] });
    });
    expect(await store.findOrCreateVaultFolder()).toBe("folder-new");
  });
});

describe("createVault", () => {
  it("POSTs a multipart body with metadata and contents", async () => {
    stubFetch(async (url, init) => {
      if (url.includes("uploadType=multipart")) {
        const body = init?.body as string;
        expect(init?.method).toBe("POST");
        expect(
          (init?.headers as Record<string, string>)["Content-Type"],
        ).toMatch(/^multipart\/related; boundary=/);
        expect(body).toContain(`"name":"${VAULT_FILENAME}"`);
        expect(body).toContain('"parents":["folder-1"]');
        expect(body).toContain("VAULT-CONTENTS");
        return Response.json({ id: "new-id", modifiedTime: "t" });
      }
      // folder lookup
      return Response.json({ files: [{ id: "folder-1" }] });
    });
    const meta = await store.createVault("VAULT-CONTENTS");
    expect(meta.id).toBe("new-id");
    expect(calls.some((c) => c.url.includes("uploadType=multipart"))).toBe(
      true,
    );
  });
});

describe("moveToFolder", () => {
  it("PATCHes addParents + removeParents", async () => {
    stubFetch(async (_url, init) => {
      expect(init?.method).toBe("PATCH");
      return Response.json({ id: "f1" });
    });
    await store.moveToFolder("f1", ["root-parent"], "folder-1");
    const url = decodeURIComponent(calls[0].url);
    expect(url).toContain("addParents=folder-1");
    expect(url).toContain("removeParents=root-parent");
  });

  it("omits removeParents when there is nothing to detach", async () => {
    stubFetch(async () => Response.json({ id: "f1" }));
    await store.moveToFolder("f1", [], "folder-1");
    expect(calls[0].url).not.toContain("removeParents");
  });
});

describe("getFileMeta", () => {
  it("fetches id + modifiedTime for conflict checks", async () => {
    stubFetch(async () => Response.json({ id: "f1", modifiedTime: "t1" }));
    const meta = await store.getFileMeta("f1");
    expect(meta).toEqual({ id: "f1", modifiedTime: "t1" });
    expect(calls[0].url).toContain("/files/f1");
    expect(calls[0].url).toContain("fields=id,modifiedTime");
  });
});

describe("updateVault", () => {
  it("PATCHes media upload and returns fresh meta", async () => {
    stubFetch(async (_url, init) => {
      expect(init?.method).toBe("PATCH");
      expect(init?.body).toBe("NEW");
      return Response.json({ id: "f1", modifiedTime: "t2" });
    });
    const meta = await store.updateVault("f1", "NEW");
    expect(meta.modifiedTime).toBe("t2");
    expect(calls[0].url).toContain("uploadType=media");
  });

  it("surfaces upstream errors as StoreError", async () => {
    stubFetch(async () => new Response("gone", { status: 404 }));
    await expect(store.updateVault("f1", "NEW")).rejects.toMatchObject({
      name: "StoreError",
      status: 404,
    });
  });
});

describe("responses that fail their schema", () => {
  const LEAK = "ciphertext-or-token-that-must-not-leak";

  async function expectBadGateway(call: () => Promise<unknown>) {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StoreError);
    expect(err).toMatchObject({ status: DRIVE_BAD_RESPONSE_STATUS, message: DRIVE_BAD_RESPONSE_MESSAGE });
    // Logged as paths + codes only.
    expect(JSON.stringify(warn.mock.calls)).not.toContain(LEAK);
    warn.mockRestore();
  }

  it("rejects a file list entry without modifiedTime", async () => {
    stubFetch(async () => Response.json({ files: [{ id: "f1", name: LEAK }] , nextPageToken: LEAK }));
    await expectBadGateway(() => store.findVaultFile());
  });

  it("rejects file metadata without an id", async () => {
    stubFetch(async () => Response.json({ modifiedTime: LEAK }));
    await expectBadGateway(() => store.getFileMeta("f1"));
  });

  it("rejects a body that isn't JSON", async () => {
    stubFetch(async () => new Response(`<html>${LEAK}</html>`));
    await expectBadGateway(() => store.updateVault("f1", "{}"));
  });

  it("rejects a created folder without an id", async () => {
    stubFetch(async (url, init) =>
      init?.method === "POST" ? Response.json({ name: LEAK }) : Response.json({}),
    );
    await expectBadGateway(() => store.findOrCreateVaultFolder());
  });

  it("keeps extra fields Google adds", async () => {
    stubFetch(async () => Response.json({ files: [{ id: "f1", modifiedTime: "t1", kind: "drive#file" }] }));
    expect(await store.findVaultFile()).toMatchObject({ id: "f1", modifiedTime: "t1" });
  });
});

describe("GoogleDriveStoreProvider contract (fake Drive backend)", () => {
  runStoreContract(() => {
    vi.stubGlobal("fetch", createFakeDrive(TOKEN));
    return new GoogleDriveStoreProvider(TOKEN);
  });
});
