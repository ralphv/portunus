// The smoke tests themselves, shared by every harness (scripts/smoke/smoke.mjs,
// scripts/smoke/full-smoke.mjs). They run in order against one page and build on
// each other — a failure stops the rest. `ctx` carries:
//   page     Playwright page (fresh context → fresh demo vault)
//   baseUrl  server under test
//   workDir  temp dir for downloads (deleted after a passing run)
//   state    scratch object tests use to hand data to later tests
//   offlineCache  false when the server runs with DISABLE_OFFLINE_MODE
//
// Add a test by appending { name, run } — the runner reports each name as it
// goes and fails on any page error, console error or unexpected HTTP error.
// A test that expects an HTTP error lists it in `allowHttp` as
// { status, method, path }; it's tolerated during that test only.
//
// Keep the "Test cases" table in SMOKE.md in sync.

import { join } from "node:path";
import { freshTotpCode, totpCode } from "./totp.mjs";

const PASSWORD = "correct horse battery staple";
const ENTRY = "Smoke entry";

// Entry-editor labels aren't for-associated — select by label text.
const field = (row, label) =>
  row.locator(
    `xpath=.//label[normalize-space()='${label}']/following-sibling::div[1]//input[1]`,
  );

const vaultOpen = (page) =>
  page.getByPlaceholder("Search entries…").waitFor({ timeout: 60_000 });

async function openSecurity(page) {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Security" }).click();
  await page.getByRole("heading", { name: "Security" }).waitFor();
}

const closeSecurity = (page) => page.getByRole("button", { name: "✕" }).click();

// Lock, then reload so the keyfile (kept in React state across a lock) is
// gone and the unlock screen starts from scratch, as in a new session.
async function lockAndReload(page) {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Lock" }).click();
  await page.getByRole("heading", { name: "Unlock vault" }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Unlock vault" }).waitFor({ timeout: 30_000 });
}

async function fillUnlock(page, state) {
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('input[type="file"]').setInputFiles(state.keyfilePath);
  await page.getByText(/^Key .+ loaded$/).waitFor();
}

const unlockButton = (page) => page.getByRole("button", { name: "Unlock", exact: true });

// localStorage slots (src/constants.ts): the offline ciphertext cache and
// the installed keyfile.
const VAULT_CACHE_KEY = "portunus.vault.cache";
const KEYFILE_STORAGE_KEY = "portunus.keyfile";
const storage = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

// From the "Create your vault" screen: password twice, download the keyfile
// into `path`, optionally install it, then Create vault.
async function createVault(page, path, { install }) {
  const pw = page.locator('input[type="password"]');
  await pw.nth(0).fill(PASSWORD);
  await pw.nth(1).fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Save your keyfile" }).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download portunus.key" }).click(),
  ]);
  await download.saveAs(path);
  const installBox = page.getByLabel("Also install the keyfile in this browser");
  if (install) await installBox.check();
  else await installBox.uncheck();
  await page.getByLabel(/I have saved the keyfile/).check();
  await page.getByRole("button", { name: "Create vault" }).click();
}

// What the offline cache must hold for the server's DISABLE_OFFLINE_MODE
// setting: the vault's ciphertext when on, nothing at all when off.
async function expectOfflineCache(page, offlineCache) {
  const cached = await storage(page, VAULT_CACHE_KEY);
  if (!offlineCache) {
    if (cached !== null) throw new Error("offline cache written although DISABLE_OFFLINE_MODE is set");
    return;
  }
  if (cached === null) throw new Error("no offline cache although DISABLE_OFFLINE_MODE is off");
  if (cached.includes(ENTRY)) throw new Error("offline cache holds plaintext");
}

export const tests = [
  {
    name: "sign in",
    // No vault yet → 404 → the create-vault flow.
    allowHttp: [{ status: 404, method: "GET", path: "/api/vault" }],
    async run({ page, baseUrl }) {
      await page.goto(baseUrl);
      await page.getByRole("button", { name: "Sign in with Google" }).click();
      await page.getByRole("heading", { name: "Create your vault" }).waitFor({ timeout: 30_000 });
    },
  },
  {
    name: "create vault",
    async run({ page, workDir, state }) {
      state.keyfilePath = join(workDir, "portunus.key");
      // Not installed, so the unlock test below exercises the file picker.
      await createVault(page, state.keyfilePath, { install: false });
      await vaultOpen(page);
    },
  },
  {
    name: "add entry",
    async run({ page }) {
      await page.getByRole("button", { name: "+ Add" }).click();
      const row = page.locator("li").first();
      await field(row, "Name").fill(ENTRY);
      await field(row, "Username").fill("smoke");
      await row.getByRole("button", { name: "Generate" }).click();
      await row.getByRole("button", { name: "Done", exact: true }).last().click();
    },
  },
  {
    name: "save",
    async run({ page }) {
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page
        .getByRole("heading", { name: "Confirm master password to save" })
        .locator("..")
        .locator('input[type="password"]')
        .fill(PASSWORD);
      await page.getByRole("button", { name: "Save to Drive" }).click();
      await page
        .getByRole("button", { name: "Save", exact: true })
        .and(page.locator(":disabled"))
        .waitFor({ timeout: 60_000 });
    },
  },
  {
    name: "offline cache after save",
    async run({ page, offlineCache }) {
      await expectOfflineCache(page, offlineCache);
      // With the cache off, a copy left from before the setting changed must
      // be wiped by the next unlock (checked after it, below).
      if (!offlineCache) {
        await page.evaluate(
          (k) => localStorage.setItem(k, '{"fileId":"old","contents":"stale"}'),
          VAULT_CACHE_KEY,
        );
      }
    },
  },
  {
    name: "reload + unlock with keyfile",
    async run({ page, state }) {
      await page.reload();
      await page.getByRole("heading", { name: "Unlock vault" }).waitFor({ timeout: 30_000 });
      await fillUnlock(page, state);
      await unlockButton(page).click();
      await vaultOpen(page);
    },
  },
  {
    name: "entry persisted",
    async run({ page }) {
      await page.getByText(ENTRY).first().waitFor();
    },
  },
  {
    name: "offline cache after unlock",
    async run({ page, offlineCache }) {
      await expectOfflineCache(page, offlineCache);
    },
  },
  {
    name: "second create is refused",
    // Create is exclusive: a PUT without fileId must not add a vault file
    // that would shadow this one.
    allowHttp: [{ status: 409, method: "PUT", path: "/api/vault" }],
    async run({ page }) {
      const res = await page.evaluate(async () => {
        const r = await fetch("/api/vault", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: "impostor" }),
        });
        return { status: r.status, body: await r.json() };
      });
      if (res.status !== 409 || res.body.error !== "vault_exists") {
        throw new Error(`expected 409 vault_exists, got ${JSON.stringify(res)}`);
      }
    },
  },
  {
    name: "refused create keeps the vault and keyfile",
    // The create screen is forced by answering the vault fetch with 404.
    allowHttp: [
      { status: 404, method: "GET", path: "/api/vault" },
      { status: 409, method: "PUT", path: "/api/vault" },
    ],
    async run({ page, workDir, state }) {
      const keyfileBefore = await storage(page, KEYFILE_STORAGE_KEY);
      await page.route("**/api/vault", (route) =>
        route.request().method() === "GET"
          ? route.fulfill({ status: 404, json: { error: "vault_not_found" } })
          : route.continue(),
      );
      await page.reload();
      await page.getByRole("heading", { name: "Create your vault" }).waitFor({ timeout: 30_000 });
      // Install ticked: a refused create must not replace this browser's key.
      await createVault(page, join(workDir, "second.key"), { install: true });
      await page.getByText("A vault already exists in your Drive").waitFor({ timeout: 30_000 });
      if ((await storage(page, KEYFILE_STORAGE_KEY)) !== keyfileBefore) {
        throw new Error("refused create replaced the installed keyfile");
      }
      await page.unroute("**/api/vault");
      await page.reload();
      await page.getByRole("heading", { name: "Unlock vault" }).waitFor({ timeout: 30_000 });
      await fillUnlock(page, state);
      await unlockButton(page).click();
      await vaultOpen(page);
      await page.getByText(ENTRY).first().waitFor();
    },
  },
  {
    name: "enable two-factor",
    async run({ page, state }) {
      await openSecurity(page);
      const setup = page.locator("form", {
        has: page.getByRole("button", { name: "Set up two-factor" }),
      });
      await setup.locator('input[type="password"]').fill(PASSWORD);
      await setup.getByRole("button", { name: "Set up two-factor" }).click();
      await page.getByRole("img", { name: "Two-factor setup QR code" }).waitFor();
      const key = await page.locator("code").filter({ hasText: /^[A-Z2-7 ]{16,}$/ }).textContent();
      state.totpSecret = key.replace(/\s+/g, "");
      await page.locator("#vault-2fa-confirm").fill(await freshTotpCode(state.totpSecret, state));
      await page.getByRole("button", { name: "Enable", exact: true }).click();
      await page.getByText("Two-factor authentication enabled.").waitFor({ timeout: 30_000 });
      await closeSecurity(page);
    },
  },
  {
    name: "unlock asks for a two-factor code",
    // The vault fetch is refused until a code is entered.
    allowHttp: [{ status: 401, method: "GET", path: "/api/vault" }],
    async run({ page, state }) {
      await lockAndReload(page);
      await page.locator("#vault-totp-code").waitFor();
      await fillUnlock(page, state);
    },
  },
  {
    name: "wrong two-factor code is rejected",
    allowHttp: [{ status: 401, method: "POST", path: "/api/vault/unlock" }],
    async run({ page, state }) {
      // A code from an hour ago: valid format, wrong value.
      await page.locator("#vault-totp-code").fill(totpCode(state.totpSecret, Date.now() - 3_600_000));
      await unlockButton(page).click();
      await page.getByText("That code didn't match").waitFor({ timeout: 30_000 });
      await page.getByRole("heading", { name: "Unlock vault" }).waitFor();
    },
  },
  {
    name: "unlock with two-factor code",
    async run({ page, state }) {
      await page.locator("#vault-totp-code").fill(await freshTotpCode(state.totpSecret, state));
      await unlockButton(page).click();
      await vaultOpen(page);
      await page.getByText(ENTRY).first().waitFor();
    },
  },
  {
    name: "disable two-factor",
    async run({ page }) {
      await openSecurity(page);
      const form = page.locator("form", {
        has: page.getByRole("button", { name: "Disable 2FA" }),
      });
      await form.locator('input[type="password"]').fill(PASSWORD);
      await form.getByRole("button", { name: "Disable 2FA" }).click();
      await page.getByText("Two-factor authentication disabled.").waitFor({ timeout: 30_000 });
      await closeSecurity(page);
    },
  },
  {
    name: "unlock without a code after disabling",
    async run({ page, state }) {
      await lockAndReload(page);
      await fillUnlock(page, state);
      if (await page.locator("#vault-totp-code").count()) {
        throw new Error("two-factor code still requested after disabling 2FA");
      }
      await unlockButton(page).click();
      await vaultOpen(page);
      await page.getByText(ENTRY).first().waitFor();
    },
  },
];
