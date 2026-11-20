// Sign in → create → add → save → reload → unlock, plus the offline cache
// and the exclusive-create guard. Every later module builds on this vault.

import { join } from "node:path";
import {
  ENTRY,
  KEYFILE_STORAGE_KEY,
  NEW_PASSWORD,
  PASSWORD,
  VAULT_CACHE_KEY,
  addEntry,
  assert,
  createVault,
  fillUnlock,
  lockAndReload,
  save,
  storage,
  unlockButton,
  unlockHeading,
  vaultOpen,
  assertPasswordsRevealable,
} from "../helpers.mjs";
import { installHibpStub, recordRequests } from "../network.mjs";

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

export const coreTests = [
  {
    name: "sign in",
    // No vault yet → 404 → the create-vault flow.
    allowHttp: [{ status: 404, method: "GET", path: "/api/vault" }],
    async run({ page, baseUrl, state }) {
      // Before anything loads: keep Have I Been Pwned lookups off the real
      // API, and log every request for the zero-knowledge check.
      await installHibpStub(page.context(), state);
      recordRequests(page.context(), state);
      // Plaintext that must never appear in a request; later tests add the
      // secrets they create.
      state.secrets = [PASSWORD, NEW_PASSWORD, ENTRY, "History entry", "Weak entry", "Spacey"];
      await page.goto(baseUrl);
      await page.getByRole("button", { name: "Sign in with Google" }).click();
      await page.getByRole("heading", { name: "Create your vault" }).waitFor({ timeout: 30_000 });
    },
  },
  {
    name: "create vault",
    async run({ page, workDir, state }) {
      state.keyfilePath = join(workDir, "portunus.key");
      await assertPasswordsRevealable(page, "create form");
      // Master-password strength meter + soft-block, before the real create:
      // a weak password is scored and warned, and Continue needs an explicit
      // override; a stronger one clears it.
      const pw = page.locator('input[type="password"]');
      await pw.nth(0).fill("password");
      await pw.nth(1).fill("password");
      await page.getByRole("meter", { name: "Password strength" }).waitFor();
      await page.getByText("Very weak").waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "Continue" }).click();
      await page
        .getByText("This password is weak and could be guessed.", { exact: false })
        .waitFor();
      assert(
        (await page.getByRole("heading", { name: "Save your keyfile" }).count()) === 0,
        "weak master password was not soft-blocked",
      );
      await page.getByRole("button", { name: "Use weak password" }).waitFor();
      await pw.nth(0).fill(PASSWORD);
      await pw.nth(1).fill(PASSWORD);
      await page.getByText(/Fair|Strong|Excellent/).waitFor({ timeout: 30_000 });
      assert(
        (await page.getByRole("button", { name: "Use weak password" }).count()) === 0,
        "weak-password override persisted after entering a stronger password",
      );
      await pw.nth(0).fill("");
      await pw.nth(1).fill("");
      // Not installed, so the unlock test below exercises the file picker.
      state.recoveryCode = await createVault(page, state.keyfilePath, { install: false });
      await vaultOpen(page);
    },
  },
  {
    name: "add entry",
    async run({ page }) {
      const row = await addEntry(page, { name: ENTRY, username: "smoke", generate: true });
      await row.getByRole("button", { name: "Done", exact: true }).last().click();
    },
  },
  {
    name: "save",
    async run({ page }) {
      await save(page);
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
      await unlockHeading(page).waitFor({ timeout: 30_000 });
      await fillUnlock(page, state);
      // The default "Install this keyfile in this browser" installs it.
      state.kid = (await page.getByText(/^Key .+ loaded$/).textContent()).match(/^Key (.+) loaded$/)[1];
      await unlockButton(page).click();
      await vaultOpen(page);
      if ((await storage(page, KEYFILE_STORAGE_KEY)) === null) {
        throw new Error("keyfile not installed after unlocking with Install ticked");
      }
    },
  },
  {
    name: "entry persisted",
    async run({ page }) {
      await page.getByText(ENTRY).first().waitFor();
    },
  },
  {
    name: "unlock shows its progress; a wrong password brings the form back",
    async run({ page, state }) {
      await lockAndReload(page);
      // Every step the progress overlay shows, in order.
      await page.evaluate(() => {
        window.__unlockSteps = [];
        new MutationObserver(() => {
          const step = document.querySelector("[data-unlock-progress] [role=status]")?.textContent;
          if (step && window.__unlockSteps.at(-1) !== step) window.__unlockSteps.push(step);
        }).observe(document.body, { subtree: true, childList: true, characterData: true });
      });
      const steps = () => page.evaluate(() => window.__unlockSteps);
      const progress = page.locator("[data-unlock-progress]");
      // Hold the vault download so the first step can be checked.
      let release;
      const held = new Promise((r) => (release = r));
      await page.route("**/api/vault", async (route) => {
        if (route.request().method() === "GET") await held;
        await route.continue();
      });
      await fillUnlock(page, state, { password: "not the password", pickFile: false });
      await unlockButton(page).click();
      await progress.getByText("Fetching your encrypted vault").waitFor();
      assert(await progress.getByText("Unlocking your vault…").isVisible(), "no unlock progress title");
      release();
      // Wrong password: the overlay goes and the form is back with the error.
      await page.getByText("Wrong password or keyfile.").waitFor({ timeout: 60_000 });
      await page.unroute("**/api/vault");
      assert(!(await progress.count()), "unlock progress still shown after a failed unlock");
      assert(await page.locator('input[type="password"]').isVisible(), "password field gone after a failed unlock");
      const first = await steps();
      assert(
        JSON.stringify(first) === JSON.stringify(["Fetching your encrypted vault", "Deriving your key"]),
        `first attempt steps: ${JSON.stringify(first)}`,
      );
      // Right password: the downloaded vault is reused, so it goes straight
      // to deriving the key, and the vault opens.
      await page.evaluate(() => (window.__unlockSteps = []));
      await fillUnlock(page, state, { pickFile: false });
      await unlockButton(page).click();
      await vaultOpen(page);
      const retry = await steps();
      assert(JSON.stringify(retry) === JSON.stringify(["Deriving your key"]), `retry steps: ${JSON.stringify(retry)}`);
      assert(!(await progress.count()), "unlock progress left over the open vault");
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
      state.otherKeyfilePath = join(workDir, "second.key");
      await createVault(page, state.otherKeyfilePath, { install: true });
      await page.getByText("A vault already exists in your Drive").waitFor({ timeout: 30_000 });
      if ((await storage(page, KEYFILE_STORAGE_KEY)) !== keyfileBefore) {
        throw new Error("refused create replaced the installed keyfile");
      }
      await page.unroute("**/api/vault");
      await page.reload();
      await unlockHeading(page).waitFor({ timeout: 30_000 });
      await fillUnlock(page, state);
      await unlockButton(page).click();
      await vaultOpen(page);
      await page.getByText(ENTRY).first().waitFor();
    },
  },
];
