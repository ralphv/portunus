import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createVault,
  downloadVault,
  findVaultFile,
  getFileMeta,
  updateVault,
  VAULT_FILENAME,
} from "./drive";

const TOKEN = "ya29.test-token";

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
    const meta = await findVaultFile(TOKEN);
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
    expect(await findVaultFile(TOKEN)).toBeNull();
  });

  it("throws DriveApiError with the upstream status", async () => {
    stubFetch(async () => new Response("denied", { status: 403 }));
    await expect(findVaultFile(TOKEN)).rejects.toMatchObject({
      name: "DriveApiError",
      status: 403,
    });
  });
});

describe("downloadVault", () => {
  it("fetches with alt=media and returns the body", async () => {
    stubFetch(async () => new Response('{"cipher":"text"}'));
    expect(await downloadVault(TOKEN, "f1")).toBe('{"cipher":"text"}');
    expect(calls[0].url).toContain("/files/f1");
    expect(calls[0].url).toContain("alt=media");
  });
});

describe("createVault", () => {
  it("POSTs a multipart body with metadata and contents", async () => {
    stubFetch(async (_url, init) => {
      const body = init?.body as string;
      expect(init?.method).toBe("POST");
      expect(
        (init?.headers as Record<string, string>)["Content-Type"],
      ).toMatch(/^multipart\/related; boundary=/);
      expect(body).toContain(`"name":"${VAULT_FILENAME}"`);
      expect(body).toContain("VAULT-CONTENTS");
      return Response.json({ id: "new-id", modifiedTime: "t" });
    });
    const meta = await createVault(TOKEN, "VAULT-CONTENTS");
    expect(meta.id).toBe("new-id");
    expect(calls[0].url).toContain("uploadType=multipart");
  });
});

describe("getFileMeta", () => {
  it("fetches id + modifiedTime for conflict checks", async () => {
    stubFetch(async () => Response.json({ id: "f1", modifiedTime: "t1" }));
    const meta = await getFileMeta(TOKEN, "f1");
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
    const meta = await updateVault(TOKEN, "f1", "NEW");
    expect(meta.modifiedTime).toBe("t2");
    expect(calls[0].url).toContain("uploadType=media");
  });

  it("surfaces upstream errors as DriveApiError", async () => {
    stubFetch(async () => new Response("gone", { status: 404 }));
    await expect(updateVault(TOKEN, "f1", "NEW")).rejects.toMatchObject({
      name: "DriveApiError",
      status: 404,
    });
  });
});
