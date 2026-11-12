// "Strict Content-Security-Policy", "Script tamper-evidence" and
// "Zero-knowledge server".

import { assert } from "../helpers.mjs";

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
      const banner = page.getByText("Unexpected script detected; verify your deployment/extensions.");
      await banner.waitFor({ timeout: 10_000 });
      assert(!(await page.evaluate(() => window.__smokeInjected)), "CSP let an injected inline script run");
      assert((await status()) === "unexpected", "self-check status didn't change to unexpected");
      await page.getByRole("button", { name: "Dismiss" }).click();
      await banner.waitFor({ state: "detached" });
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
];
