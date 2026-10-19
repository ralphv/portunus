import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn(), getAccessToken: vi.fn() }));

import { GET, PUT } from "./route";

const put = (body: unknown) =>
  PUT(
    new Request("http://localhost/api/vault", {
      method: "PUT",
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );
const get = () => GET(new Request("http://localhost/api/vault") as unknown as NextRequest);

beforeEach(() => {
  vi.stubEnv("PORTUNUS_DEMO_MODE", "1");
  (globalThis as { __portunusMemoryFiles?: unknown }).__portunusMemoryFiles = undefined;
});

describe("/api/vault in demo mode", () => {
  it("creates, reads, and updates the vault; rejects stale writes with 409", async () => {
    expect((await get()).status).toBe(404);

    const created = await (await put({ contents: "v1" })).json();
    const read = await (await get()).json();
    expect(read).toEqual({
      fileId: created.fileId,
      modifiedTime: created.modifiedTime,
      contents: "v1",
    });

    const updated = await put({
      fileId: created.fileId,
      contents: "v2",
      baseModifiedTime: created.modifiedTime,
    });
    expect(updated.status).toBe(200);

    const stale = await put({
      fileId: created.fileId,
      contents: "v3",
      baseModifiedTime: created.modifiedTime,
    });
    expect(stale.status).toBe(409);
    expect((await (await get()).json()).contents).toBe("v2");
  });

  it("returns file_gone for an unknown fileId", async () => {
    const res = await put({ fileId: "nope", contents: "x" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "file_gone" });
  });
});
