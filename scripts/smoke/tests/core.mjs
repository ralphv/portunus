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
  createVault,
  fillUnlock,
  save,
  storage,
  unlockButton,
  unlockHeading,
  vaultOpen,
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
