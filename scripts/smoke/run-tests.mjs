// Runs scripts/smoke/tests.mjs in a fresh browser against a demo-mode server
// that a harness has already started. Returns true on success; on failure
// prints the error and saves a screenshot + page HTML to a temp dir (or to
// SMOKE_ARTIFACTS_DIR).
//
// Options (env): HEADED=1 shows the browser, slowed down; SLOWMO=ms
// overrides the delay; KEEP_OPEN=1 implies HEADED and leaves the browser
// open after the run (pass or fail) until Enter is pressed;
// SMOKE_ARTIFACTS_DIR=dir keeps the failure files in a fixed place (CI
// uploads it); SMOKE_SCREENSHOTS=1 also saves a screenshot after every step
// (to SMOKE_ARTIFACTS_DIR, default ./smoke-artifacts). Under GitHub Actions
// a results table goes to the job summary. See SMOKE.md.

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { chromium } from "playwright";
import { blockExternalRequests } from "./network.mjs";
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
  const screenshots = ["1", "true"].includes(process.env.SMOKE_SCREENSHOTS ?? "");
  // Step screenshots must outlive a passing run, so they never go to workDir.
  const artifactsDir = process.env.SMOKE_ARTIFACTS_DIR || (screenshots ? "smoke-artifacts" : workDir);
  const stepsDir = join(artifactsDir, "steps");
  if (screenshots) {
    rmSync(stepsDir, { recursive: true, force: true }); // no leftovers from an older run
    mkdirSync(stepsDir, { recursive: true });
  }
  const problems = [];
  const keepOpen = Boolean(process.env.KEEP_OPEN);
  const headed = keepOpen || Boolean(process.env.HEADED);
  const browser = await chromium.launch({
    headless: !headed,
    slowMo: Number(process.env.SLOWMO ?? (headed ? 300 : 0)),
  });
  const context = await browser.newContext({
    acceptDownloads: true,
    // The copy buttons are checked by reading the clipboard back.
    permissions: ["clipboard-read", "clipboard-write"],
  });
  // First route on the context, so the tests' own routes (the Pwned
  // Passwords stub) take precedence over it.
  await blockExternalRequests(context, baseUrl, (msg) => problems.push(msg));
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
  // Errors the running test declared in `allowHttp` / `allowConsole` are
  // expected.
  let allowHttp = [];
  let allowConsole = [];
  page.on("console", (m) => {
    if (m.type() !== "error" || m.text().startsWith("Failed to load resource")) return;
    if (allowConsole.some((re) => re.test(m.text()))) return;
    problems.push(`console.error: ${m.text()}`);
  });
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
  const results = []; // { name, ok, ms, shot } per step that ran
  // "07-entry-persisted.png": numbered like the SMOKE.md table.
  const shotName = (i, name) =>
    `${String(i + 1).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`;
  async function stepShot(i, name, suffix = "") {
    if (!screenshots) return undefined;
    const file = shotName(i, name).replace(/\.png$/, `${suffix}.png`);
    await page.screenshot({ path: join(stepsDir, file), fullPage: true }).catch(() => {});
    return file;
  }
  try {
    for (const [i, test] of tests.entries()) {
      current = test.name;
      allowHttp = test.allowHttp ?? [];
      allowConsole = test.allowConsole ?? [];
      console.log(`• ${test.name}`);
      const started = Date.now();
      try {
        await test.run(ctx);
        if (problems.length) throw new Error(`browser reported:\n  ${problems.join("\n  ")}`);
      } catch (err) {
        results.push({ name: test.name, ok: false, ms: Date.now() - started, shot: await stepShot(i, test.name, "-failed") });
        throw err;
      }
      results.push({ name: test.name, ok: true, ms: Date.now() - started, shot: await stepShot(i, test.name) });
    }
  } catch (err) {
    ok = false;
    console.error(`\nSMOKE FAILED in "${current}": ${err.message}`);
    mkdirSync(artifactsDir, { recursive: true });
    const shotPath = join(artifactsDir, "failure.png");
    const htmlPath = join(artifactsDir, "failure.html");
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

  if (screenshots) console.log(`\nStep screenshots: ${stepsDir} (${results.length})`);
  writeJobSummary({ ok, offlineCache, results, total: tests.length, screenshots });
  if (ok) {
    rmSync(workDir, { recursive: true, force: true });
    console.log("\nSMOKE PASSED");
  }
  return ok;
}

// GitHub Actions renders $GITHUB_STEP_SUMMARY on the run's page: one table
// per job, so each step's result (and screenshot name) is visible without
// opening the log or downloading the artifact.
function writeJobSummary({ ok, offlineCache, results, total, screenshots }) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const cell = (text) => String(text).replace(/\|/g, "\\|");
  const lines = [
    `### Smoke tests (offline cache ${offlineCache ? "on" : "off"}): ${ok ? "✅ passed" : "❌ failed"}`,
    "",
    `${results.filter((r) => r.ok).length} of ${total} steps passed.` +
      (screenshots ? " Screenshots: the `smoke-screenshots-…` artifact, folder `steps/`." : ""),
    "",
    `| # | Step | Result | Time${screenshots ? " | Screenshot" : ""} |`,
    `|---|---|---|---${screenshots ? "|---" : ""}|`,
    ...results.map(
      (r, i) =>
        `| ${i + 1} | ${cell(r.name)} | ${r.ok ? "✅" : "❌"} | ${(r.ms / 1000).toFixed(1)} s` +
        `${screenshots ? ` | ${r.shot ? `\`${r.shot}\`` : "—"}` : ""} |`,
    ),
    "",
  ];
  appendFileSync(file, lines.join("\n"));
}
