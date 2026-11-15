// Server-only: reads a request body as UTF-8 text without ever buffering
// more than `maxBytes`. A declared Content-Length over the cap is refused
// before anything is read; the stream is then counted as it arrives, so a
// missing or understated Content-Length can't get past the cap either.

export type LimitedBodyResult = { ok: true; text: string } | { ok: false };

const DECIMAL = /^\d+$/;

export async function readLimitedBody(
  req: Request,
  maxBytes: number,
): Promise<LimitedBodyResult> {
  const declared = req.headers.get("content-length")?.trim();
  if (declared && DECIMAL.test(declared) && Number(declared) > maxBytes) {
    return { ok: false };
  }
  if (!req.body) return { ok: true, text: "" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}
