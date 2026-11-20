// "Strict Content-Security-Policy" (plus the other security response
// headers), "Script tamper-evidence" and "Zero-knowledge server".

import { assert } from "../helpers.mjs";
import { blockExternalRequests } from "../network.mjs";

const INTEGRITY_BANNER_TITLE = "Unexpected page modification detected";
const PROFILE_TIP = /separate browser profile with no extensions/;

export const pageSecurityTests = [
  {
    name: "strict content security policy",
    async run({ page, baseUrl }) {
      const res = await page.request.get(baseUrl);
      const csp = res.headers()["content-security-policy"] ?? "";
      const directives = Object.fromEntries(
        csp.split(";").map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]),
      );
      const script = directives["script-src"] ?? [];
      assert(script.includes("'self'"), `script-src lacks 'self': ${csp}`);
      assert(script.some((s) => s.startsWith("'nonce-")), "script-src has no per-request nonce");
      assert(script.some((s) => s.startsWith("'sha256-")), "script-src has no build-time hashes");
      assert(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'"), `script-src is unsafe: ${csp}`);
      assert(directives["object-src"]?.join(" ") === "'none'", "object-src isn't 'none'");
      assert(directives["base-uri"]?.join(" ") === "'none'", "base-uri isn't 'none'");
      assert(directives["frame-ancestors"]?.join(" ") === "'none'", "frame-ancestors isn't 'none'");
      const expect = {
        "default-src": "'self'",
        "connect-src": "'self'",
        "style-src": "'self'",
        "style-src-attr": "'unsafe-inline'",
        "font-src": "'self'",
        "img-src": "'self' data: blob:",
        "manifest-src": "'self'",
        "worker-src": "'self' blob:",
        "form-action": "'self' https://accounts.google.com",
      };
      for (const [name, value] of Object.entries(expect)) {
        assert(directives[name]?.join(" ") === value, `${name} is "${directives[name]?.join(" ")}", expected "${value}"`);
      }
      // The run itself (every step before and after this one) fails on any
      // CSP violation, so the tighter policy is exercised end to end.
    },
  },
  {
    name: "security response headers",
    async run({ page, baseUrl }) {
      const expectCommon = (headers, where) => {
        assert(headers["x-content-type-options"] === "nosniff", `${where}: no X-Content-Type-Options: nosniff`);
      };
      const pageHeaders = (await page.request.get(baseUrl)).headers();
      expectCommon(pageHeaders, "page");
      assert(pageHeaders["referrer-policy"] === "no-referrer", `page: Referrer-Policy is ${pageHeaders["referrer-policy"]}`);
      const pp = pageHeaders["permissions-policy"] ?? "";
      for (const off of ["camera=()", "microphone=()", "geolocation=()"]) {
        assert(pp.includes(off), `Permissions-Policy lacks ${off}: ${pp}`);
      }
      for (const on of ["clipboard-write=(self)", "publickey-credentials-get=(self)", "publickey-credentials-create=(self)"]) {
        assert(pp.includes(on), `Permissions-Policy lacks ${on}: ${pp}`);
      }
      // HSTS only when AUTH_URL is https://; the demo server runs over http.
      const https = new URL(baseUrl).protocol === "https:";
      assert(
        https === Boolean(pageHeaders["strict-transport-security"]),
        `Strict-Transport-Security ${pageHeaders["strict-transport-security"] ? "sent" : "missing"} over ${new URL(baseUrl).protocol}`,
      );
      expectCommon((await page.request.get(`${baseUrl}/api/vault`)).headers(), "API");
      // Static chunks bypass the middleware; next.config.ts adds nosniff.
      const chunk = await page.evaluate(() => document.querySelector('script[src*="/_next/static/"]')?.src);
      assert(chunk, "no static script on the page");
      expectCommon((await page.request.get(chunk)).headers(), "static chunk");
    },
  },
  {
    name: "injected script is blocked and flagged",
    // The blocked script is reported as a CSP violation — that's the point.
    allowConsole: [
      /^CSP violation: script-src/,
      /^Refused to execute inline script/,
      /^Executing inline script violates the following Content Security Policy directive/,
    ],
    async run({ page }) {
      const status = () => page.evaluate(() => document.documentElement.dataset.scriptIntegrity);
      assert((await status()) === "ok", `script self-check isn't ok before the test: ${await status()}`);
      await page.evaluate(() => {
        const s = document.createElement("script");
        s.textContent = "window.__smokeInjected = true";
        document.body.append(s);
      });
      const banner = page.getByText(INTEGRITY_BANNER_TITLE);
      await banner.waitFor({ timeout: 10_000 });
      assert(!(await page.evaluate(() => window.__smokeInjected)), "CSP let an injected inline script run");
      assert((await status()) === "unexpected", "self-check status didn't change to unexpected");
      await page.getByRole("button", { name: "Dismiss" }).click();
      await banner.waitFor({ state: "detached" });
    },
  },
  {
    // The native-builtin tamper check (src/lib/native-integrity.ts): a
    // malicious extension patches page builtins to steal secrets. Tier-1
    // patches (the vault Worker channel) must raise the banner; tier-2 patches
    // (fetch and friends, which benign extensions also hook) must not. Each
    // runs in a throwaway context so patching a builtin can't corrupt the
    // shared vault page.
    name: "native-API tamper: tier-1 warns, tier-2 stays quiet",
    async run({ page, baseUrl }) {
      const fresh = async (patch) => {
        const context = await page.context().browser().newContext();
        await blockExternalRequests(context, baseUrl, () => {});
        await context.addInitScript(patch);
        const p = await context.newPage();
        await p.goto(baseUrl);
        return { context, p };
      };

      // Tier 1: wrap Worker.prototype.postMessage (the PoC's chokepoint).
      {
        const { context, p } = await fresh(() => {
          const real = Worker.prototype.postMessage;
          Worker.prototype.postMessage = function (...args) {
            return real.apply(this, args);
          };
        });
        try {
          await p.getByText(INTEGRITY_BANNER_TITLE).waitFor({ timeout: 15_000 });
          await p.getByText(PROFILE_TIP).waitFor({ timeout: 5_000 });
          await p.getByText("Worker.prototype.postMessage").waitFor({ timeout: 5_000 });
        } finally {
          await context.close();
        }
      }

      // Tier 2: wrap fetch. Logged to the console only — no banner.
      {
        const { context, p } = await fresh(() => {
          const real = window.fetch;
          window.fetch = (...args) => real.apply(window, args);
        });
        try {
          // Let the page settle and the integrity check run.
          await p.getByRole("button", { name: /sign in with google/i }).waitFor({ timeout: 15_000 });
          await p.waitForTimeout(1500);
          assert(
            (await p.getByText(INTEGRITY_BANNER_TITLE).count()) === 0,
            "tier-2 (fetch) patch wrongly raised the tamper banner",
          );
        } finally {
          await context.close();
        }
      }
    },
  },
  {
    name: "zero-knowledge: nothing readable reaches the server",
    async run({ state }) {
      const uploads = state.requests.filter((r) => r.method === "PUT" && new URL(r.url).pathname === "/api/vault");
      assert(uploads.length >= 10, `only ${uploads.length} vault uploads were recorded`);
      for (const { url, body } of state.requests) {
        for (const secret of state.secrets) {
          assert(!url.includes(secret) && !body.includes(secret), `plaintext "${secret}" sent in a request to ${url}`);
        }
      }
      // What is uploaded is an encrypted envelope.
      const { contents } = JSON.parse(uploads.at(-1).body);
      const envelope = JSON.parse(contents);
      assert(envelope.ciphertext && envelope.nonce, "upload isn't an encrypted envelope");
    },
  },
  {
    name: "oversized vault upload refused",
    allowHttp: [{ status: 413, method: "PUT", path: "/api/vault" }],
    async run({ page }) {
      const res = await page.evaluate(async () => {
        // Just over the 10 MiB vault limit plus its JSON frame.
        const contents = "a".repeat(10 * 1024 * 1024 + 64 * 1024 + 1);
        const r = await fetch("/api/vault", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents }),
        });
        return { status: r.status, body: await r.json() };
      });
      assert(
        res.status === 413 && res.body.error === "payload_too_large",
        `expected 413 payload_too_large, got ${JSON.stringify(res)}`,
      );
      // The vault is untouched.
      const vault = await page.evaluate(async () => (await fetch("/api/vault")).status);
      assert(vault === 200, `GET /api/vault after the refused upload answered ${vault}`);
    },
  },
];
