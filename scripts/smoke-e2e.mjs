// End-to-end smoke test of the production build in a real browser. Starts
// the standalone server (demo mode: stubbed sign-in, in-memory vault) once
// per scenario and drives the UI with Playwright:
//
//   npm run build && npm run test:e2e
//
// Needs `npx playwright install chromium`. Covers create → save → lock →
// unlock, the exclusive-create guard (409 vault_exists: API and UI, without
// replacing the installed keyfile), and the DISABLE_OFFLINE_MODE switch
// (offline ciphertext cache on vs. off). Exits non-zero on the first failure.

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const STANDALONE = join(ROOT, ".next/standalone");
const PASSWORD = "correct horse battery staple";
const CACHE_KEY = "portunus.vault.cache";
const KEYFILE_KEY = "portunus.keyfile";

if (!existsSync(join(STANDALONE, "server.js"))) {
  console.error("No standalone build — run `npm run build` first.");
  process.exit(1);
}
// The standalone server serves static assets from beside itself (the
// Dockerfile copies them the same way).
cpSync(join(ROOT, ".next/static"), join(STANDALONE, ".next/static"), { recursive: true });
cpSync(join(ROOT, "public"), join(STANDALONE, "public"), { recursive: true });

function freePort() {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startServer(env) {
  const port = await freePort();
  const proc = spawn(process.execPath, ["server.js"], {
    cwd: STANDALONE,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      PORTUNUS_DEMO_MODE: "1",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  proc.stdout.on("data", (d) => (log += d));
  proc.stderr.on("data", (d) => (log += d));
  // localhost, not 127.0.0.1: Auth.js redirects there after sign-in, and the
  // session cookie must be on the same host.
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) return { base, proc, log: () => log };
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error(`Server did not start:\n${log}`);
}

function assert(cond, message) {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

const field = (row, label) =>
  row.locator(
    `xpath=.//label[normalize-space()='${label}']/following-sibling::div[1]//input[1]`,
  );
const storage = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const openList = (page) =>
  page.getByPlaceholder("Search entries…").waitFor({ timeout: 60_000 });

async function signInAndCreate(
  page,
  base,
  workDir,
  { install = true, signIn = true } = {},
) {
  await page.goto(base);
  if (signIn) await page.getByRole("button", { name: "Sign in with Google" }).click();
  await page.getByRole("heading", { name: "Create your vault" }).waitFor({ timeout: 30_000 });
  const pw = page.locator('input[type="password"]');
  await pw.nth(0).fill(PASSWORD);
  await pw.nth(1).fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Save your keyfile" }).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download portunus.key" }).click(),
  ]);
  const keyfilePath = join(workDir, `portunus-${Date.now()}.key`);
  await download.saveAs(keyfilePath);
  const installBox = page.getByLabel("Also install the keyfile in this browser");
  if (install) await installBox.check();
  else await installBox.uncheck();
  await page.getByLabel(/I have saved the keyfile/).check();
  await page.getByRole("button", { name: "Create vault" }).click();
  return keyfilePath;
}

async function addEntryAndSave(page, name) {
  await page.getByRole("button", { name: "+ Add" }).click();
  await field(page.locator("li").first(), "Name").fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("heading", { name: "Confirm master password to save" })
    .locator("..")
    .locator('input[type="password"]')
    .fill(PASSWORD);
  await page.getByRole("button", { name: "Save to Drive" }).click();
  // Save is disabled again once nothing is dirty.
  await page
    .getByRole("button", { name: "Save", exact: true })
    .and(page.locator(":disabled"))
    .waitFor({ timeout: 30_000 });
}

async function lockAndUnlock(page) {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Lock" }).click();
  await page.getByRole("heading", { name: "Unlock vault" }).waitFor();
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await openList(page);
}

async function scenario(name, env, run) {
  const server = await startServer(env);
  const browser = await chromium.launch();
  // Keep the app's service worker out of the way of request interception.
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  if (process.env.SMOKE_DEBUG) {
    page.on("console", (m) => console.log(`  [console.${m.type()}] ${m.text()}`));
    page.on("response", async (r) => {
      if (!r.url().includes("/api/")) return;
      const cookies = (await r.headersArray())
        .filter((h) => h.name.toLowerCase() === "set-cookie")
        .map((h) => h.value.split(";").slice(0, 1).join("").slice(0, 40) + "…");
      console.log(`  [${r.status()}] ${r.request().method()} ${r.url()} ${cookies.join(" ")}`);
    });
  }
  const workDir = mkdtempSync(join(tmpdir(), "portunus-smoke-"));
  try {
    await run({ page, context, base: server.base, workDir });
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}\n${e.stack}\n--- server log ---\n${server.log()}`);
    await page.screenshot({ path: join(workDir, "failure.png") }).catch(() => {});
    console.error(`(screenshot: ${join(workDir, "failure.png")})`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.proc.kill();
    if (!process.exitCode) rmSync(workDir, { recursive: true, force: true });
  }
}

await scenario("offline cache on: create, save, lock/unlock, exclusive create", {}, async ({ page, base, workDir }) => {
  await signInAndCreate(page, base, workDir);
  await openList(page);
  assert((await storage(page, CACHE_KEY)) !== null, "vault cached after create");

  await addEntryAndSave(page, "Smoke entry");
  const cached = JSON.parse(await storage(page, CACHE_KEY));
  assert(cached.contents && !cached.contents.includes("Smoke entry"), "cache holds ciphertext only");

  await lockAndUnlock(page);
  await page.getByText("Smoke entry").waitFor();

  // API: a second create must be refused, not shadow the vault.
  const res = await page.evaluate(async () => {
    const r = await fetch("/api/vault", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: "impostor" }),
    });
    return { status: r.status, body: await r.json() };
  });
  assert(res.status === 409 && res.body.error === "vault_exists", `create refused: ${JSON.stringify(res)}`);

  // UI: force the create flow (GET answers 404) and finish it. The server
  // refuses, the user is told so, and the installed keyfile survives.
  const keyfileBefore = await storage(page, KEYFILE_KEY);
  assert(keyfileBefore !== null, "keyfile installed");
  await page.route("**/api/vault", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 404, json: { error: "vault_not_found" } })
      : route.continue(),
  );
  await signInAndCreate(page, base, workDir, { install: true, signIn: false });
  await page.getByText("A vault already exists in your Drive").waitFor();
  assert((await storage(page, KEYFILE_KEY)) === keyfileBefore, "installed keyfile not replaced");
  await page.unroute("**/api/vault");

  // The original vault is untouched and still opens.
  await page.reload();
  await page.getByRole("heading", { name: "Unlock vault" }).waitFor({ timeout: 30_000 });
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await openList(page);
  await page.getByText("Smoke entry").waitFor();
});

await scenario("DISABLE_OFFLINE_MODE=1: no ciphertext cached at any point", { DISABLE_OFFLINE_MODE: "1" }, async ({ page, base, workDir }) => {
  // A stale cache from before the flag was set must be wiped too.
  await page.goto(base);
  await page.evaluate((k) => localStorage.setItem(k, '{"fileId":"old","contents":"stale"}'), CACHE_KEY);
  await signInAndCreate(page, base, workDir);
  await openList(page);
  assert((await storage(page, CACHE_KEY)) === null, "no cache after create");
  await addEntryAndSave(page, "Uncached entry");
  assert((await storage(page, CACHE_KEY)) === null, "no cache after save");
  await lockAndUnlock(page);
  await page.getByText("Uncached entry").waitFor();
  assert((await storage(page, CACHE_KEY)) === null, "no cache after unlock");
});
