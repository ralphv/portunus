import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { collect, extractInlineScripts } from "../../scripts/script-integrity.mjs";
import {
  classifyScript,
  isDataScript,
  scriptRecorderInitScript,
  sha256Base64,
  type ScriptIntegrityManifestInterface,
} from "./script-integrity";

const origin = "https://vault.example";
const manifest: ScriptIntegrityManifestInterface = {
  generated: true,
  chunks: { "/_next/static/chunks/app.js": "AAAA" },
  inline: [],
};

async function inline(text: string, nonce = "", pageNonce: string | null = null) {
  const m = { ...manifest, inline: [await sha256Base64("known()")] };
  return classifyScript(
    { src: null, type: "", nonce },
    text,
    text.trim() ? await sha256Base64(text) : null,
    m,
    { origin, pageNonce },
  );
}

describe("sha256Base64", () => {
  it("matches node's base64 SHA-256 (the build-time hash)", async () => {
    const text = 'try{var t=localStorage.getItem("x")}catch(e){} — ü';
    expect(await sha256Base64(text)).toBe(
      createHash("sha256").update(text).digest("base64"),
    );
  });
});

describe("classifyScript", () => {
  const src = (s: string) =>
    classifyScript({ src: s, type: "", nonce: "" }, "", null, manifest, {
      origin,
      pageNonce: null,
    });

  it("accepts same-origin chunks of this build, relative or absolute", () => {
    expect(src("/_next/static/chunks/app.js")).toEqual({
      ok: true,
      chunk: "/_next/static/chunks/app.js",
    });
    expect(src(`${origin}/_next/static/chunks/app.js?v=1`).ok).toBe(true);
  });

  it("flags unknown paths and cross-origin scripts", () => {
    expect(src("/_next/static/chunks/other.js")).toMatchObject({
      ok: false,
      finding: { reason: "not a chunk of this build" },
    });
    expect(src("https://cdn.evil/_next/static/chunks/app.js")).toMatchObject({
      ok: false,
      finding: { reason: "cross-origin script" },
    });
  });

  it("accepts inline scripts by build hash or matching page nonce", async () => {
    expect((await inline("known()")).ok).toBe(true);
    expect((await inline("streamed()", "n1", "n1")).ok).toBe(true);
    expect((await inline("   ")).ok).toBe(true);
  });

  it("flags unknown inline scripts and foreign nonces", async () => {
    expect(await inline("steal()")).toMatchObject({
      ok: false,
      finding: { label: "inline: steal()", reason: "inline script not in this build" },
    });
    expect(await inline("steal()", "n2", "n1")).toMatchObject({
      ok: false,
      finding: { reason: "inline script with a foreign nonce" },
    });
    expect((await inline("steal()", "n2", null)).ok).toBe(false);
  });

  it("ignores non-executable data blocks only", () => {
    expect(isDataScript("application/ld+json")).toBe(true);
    expect(isDataScript(" Application/JSON ")).toBe(true);
    expect(isDataScript("module")).toBe(false);
    expect(isDataScript("importmap")).toBe(false);
  });
});

describe("extractInlineScripts", () => {
  it("returns raw inline bodies and skips src/empty scripts", () => {
    const html =
      `<head><script>a()</script><script src="/x.js" async=""></script>` +
      `<script id="_R_">b("&amp;")</script><script></script>` +
      `<SCRIPT type="module">c()</SCRIPT></head>`;
    expect(extractInlineScripts(html)).toEqual(["a()", 'b("&amp;")', "c()"]);
  });

  it("hashes the recorder init script the same way at build and runtime", async () => {
    const [body] = extractInlineScripts(`<script>${scriptRecorderInitScript}</script>`);
    expect(await sha256Base64(body)).toBe(
      createHash("sha256").update(scriptRecorderInitScript).digest("base64"),
    );
  });

  it("collect() tolerates a missing build dir", () => {
    expect(collect("/nonexistent-dist")).toEqual({ generated: true, chunks: {}, inline: [] });
  });
});
