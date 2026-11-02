// Runs scripts/smoke/tests.mjs in a fresh browser against a demo-mode server
// that a harness has already started. Returns true on success; on failure
// prints the error and saves a screenshot + page HTML to a temp dir.
//
// Options (env): HEADED=1 shows the browser, slowed down; SLOWMO=ms
// overrides the delay; KEEP_OPEN=1 implies HEADED and leaves the browser
// open after the run (pass or fail) until Enter is pressed. See SMOKE.md.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { chromium } from "playwright";
import { tests } from "./tests.mjs";

export async function runSmokeTests(baseUrl) {
  // Demo mode answers an unauthenticated /api/vault with vault_not_found
  // (Google mode would 401).
  console.log(`• precheck ${baseUrl}/api/vault`);
  const pre = await fetch(`${baseUrl}/api/vault`)
    .then((r) => r.json())
    .catch((e) => ({ error: e.cause?.code ?? e.message }));
  if (pre.error !== "vault_not_found") {
    console.error(`Expected a demo-mode server at ${baseUrl}, /api/vault said: ${JSON.stringify(pre)}`);
    return false;
  }

  const workDir = mkdtempSync(join(tmpdir(), "portunus-smoke-"));
  const problems = [];
  const keepOpen = Boolean(process.env.KEEP_OPEN);
  const headed = keepOpen || Boolean(process.env.HEADED);
  const browser = await chromium.launch({
    headless: !headed,
    slowMo: Number(process.env.SLOWMO ?? (headed ? 300 : 0)),
  });
  const context = await browser.newContext({ acceptDownloads: true });
  // Surface CSP violations as console errors so the listener below sees them.
  await context.addInitScript(() => {
    addEventListener("securitypolicyviolation", (e) =>
      console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || "inline"}`),
    );
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  // HTTP errors are reported via `response` (with the URL) instead of the
  // browser's URL-less "Failed to load resource" console message.
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) {
      problems.push(`console.error: ${m.text()}`);
    }
  });
  // Errors the running test declared in `allowHttp` are expected.
  let allowHttp = [];
  page.on("response", (r) => {
    if (r.status() < 400) return;
    const method = r.request().method();
    const { pathname } = new URL(r.url());
    const expected = allowHttp.some(
      (a) => a.status === r.status() && a.method === method && a.path === pathname,
    );
    if (!expected) problems.push(`HTTP ${r.status()} ${method} ${r.url()}`);
  });
  page.on("dialog", (d) => d.accept());

  // The tests can't see the server's env: DISABLE_OFFLINE_MODE must be set
  // for the smoke run exactly as for the server (full-smoke passes it on).
  const offlineCache = !["1", "true"].includes(process.env.DISABLE_OFFLINE_MODE ?? "");
  console.log(`• offline cache expected ${offlineCache ? "on" : "off (DISABLE_OFFLINE_MODE)"}`);
  const ctx = { page, baseUrl, workDir, state: {}, offlineCache };
  let current = "";
  let ok = true;
  try {
    for (const test of tests) {
      current = test.name;
      allowHttp = test.allowHttp ?? [];
      console.log(`• ${test.name}`);
      await test.run(ctx);
      if (problems.length) throw new Error(`browser reported:\n  ${problems.join("\n  ")}`);
    }
  } catch (err) {
    ok = false;
    console.error(`\nSMOKE FAILED in "${current}": ${err.message}`);
    const shotPath = join(workDir, "failure.png");
    const htmlPath = join(workDir, "failure.html");
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    writeFileSync(htmlPath, await page.content().catch(() => ""));
    console.error(`Screenshot: ${shotPath}\nHTML: ${htmlPath}`);
  } finally {
    if (keepOpen && process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      await rl.question(`\nBrowser left open at ${page.url()} — press Enter to close it… `);
      rl.close();
    } else if (keepOpen) {
      console.warn("KEEP_OPEN ignored: stdin is not a terminal.");
    }
    await context.close();
    await browser.close();
  }

  if (ok) {
    rmSync(workDir, { recursive: true, force: true });
    console.log("\nSMOKE PASSED");
  }
  return ok;
}
