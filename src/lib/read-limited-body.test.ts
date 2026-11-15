import { describe, expect, it } from "vitest";

import { readLimitedBody } from "./read-limited-body";

// A body streamed in `parts`, with an optional (possibly lying) declared length.
function streamed(parts: string[], contentLength?: string): Request {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
  const headers = new Headers();
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return new Request("http://localhost/x", {
    method: "PUT",
    body,
    headers,
    duplex: "half",
  } as RequestInit);
}

describe("readLimitedBody", () => {
  it("returns a body at or under the cap", async () => {
    expect(await readLimitedBody(streamed(["ab", "cd"]), 4)).toEqual({ ok: true, text: "abcd" });
  });

  it("decodes multi-byte UTF-8 split across chunks", async () => {
    const bytes = new TextEncoder().encode("é");
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 1));
        c.enqueue(bytes.slice(1));
        c.close();
      },
    });
    const req = new Request("http://localhost/x", { method: "PUT", body, duplex: "half" } as RequestInit);
    expect(await readLimitedBody(req, 10)).toEqual({ ok: true, text: "é" });
  });

  it("refuses an over-cap Content-Length without reading the body", async () => {
    const body = new ReadableStream<Uint8Array>({ pull() {} });
    const req = new Request("http://localhost/x", {
      method: "PUT",
      body,
      headers: { "content-length": "11" },
      duplex: "half",
    } as RequestInit);
    expect(await readLimitedBody(req, 10)).toEqual({ ok: false });
    expect(req.bodyUsed).toBe(false);
  });

  it("refuses an over-cap stream with no Content-Length", async () => {
    expect(await readLimitedBody(streamed(["12345", "678901"]), 10)).toEqual({ ok: false });
  });

  it("refuses an over-cap stream whose Content-Length understates it", async () => {
    expect(await readLimitedBody(streamed(["12345", "678901"], "3"), 10)).toEqual({ ok: false });
  });

  it("stops reading once the cap is passed", async () => {
    let served = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        served++;
        c.enqueue(new Uint8Array(4));
      },
    });
    const req = new Request("http://localhost/x", { method: "PUT", body, duplex: "half" } as RequestInit);
    expect(await readLimitedBody(req, 10)).toEqual({ ok: false });
    expect(served).toBeLessThan(5);
  });

  it("returns empty text for a request without a body", async () => {
    expect(await readLimitedBody(new Request("http://localhost/x"), 10)).toEqual({ ok: true, text: "" });
  });
});
