// "Password and keyfile required" and "Per-device keyfile": each secret alone
// is refused, the recovery code stands in for the file, and the keyfile can
// be installed in / removed from the browser.

import {
  DEMO_EMAIL,
  ENTRY,
  KEYFILE_STORAGE_KEY,
  PASSWORD,
  assert,
  fillUnlock,
  lockAndReload,
  menu,
  storage,
  unlock,
  unlockButton,
  unlockHeading,
  vaultOpen,
} from "../helpers.mjs";

const WRONG = "Wrong password or keyfile.";

export const keyfileTests = [
  {
    name: "wrong password is refused",
    async run({ page }) {
      await lockAndReload(page);
      // The installed keyfile loads by itself.
      await page.getByText(/^Key .+ loaded$/).waitFor();
      await page.getByText(`Signed in as ${DEMO_EMAIL}`).waitFor();
      await page.locator('input[type="password"]').fill("not the master password");
      await unlockButton(page).click();
      await page.getByText(WRONG).waitFor({ timeout: 30_000 });
      await unlockHeading(page).waitFor();
    },
  },
  {
    name: "master password stays out of the DOM",
    async run({ page }) {
      const input = page.locator('input[type="password"]');
      await input.fill(PASSWORD);
      assert((await input.getAttribute("value")) === null, "master password input has a value attribute");
      assert(!(await page.content()).includes(PASSWORD), "master password appears in the page HTML");
    },
  },
  {
    name: "wrong keyfile is refused",
    async run({ page, state }) {
      // The keyfile from the refused second create: valid, but not this vault's.
      await page.locator('input[type="file"]').setInputFiles(state.otherKeyfilePath);
      await page.getByText(/^Key .+ loaded$/).waitFor();
      await page.locator('input[type="password"]').fill(PASSWORD);
      await unlockButton(page).click();
      await page.getByText(WRONG).waitFor({ timeout: 30_000 });
    },
  },
  {
    name: "remove key from the unlock screen",
    async run({ page }) {
      await page.reload();
      await unlockHeading(page).waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "Remove key from this browser" }).click();
      await page.getByRole("button", { name: "Choose portunus.key…" }).waitFor();
      assert((await storage(page, KEYFILE_STORAGE_KEY)) === null, "keyfile still installed after Remove key");
    },
  },
  {
    name: "unlock with recovery code",
    async run({ page, state }) {
      await page.getByRole("button", { name: "Restore from recovery code instead" }).click();
      await page.getByPlaceholder("XXXXX-XXXXX-…").fill(state.recoveryCode);
      await page.getByRole("button", { name: "Use recovery code" }).click();
      await page.getByText(`Key ${state.kid} loaded`).waitFor();
      await page.locator('input[type="password"]').fill(PASSWORD);
      await unlockButton(page).click();
      await vaultOpen(page);
      await page.getByText(ENTRY).first().waitFor();
      assert((await storage(page, KEYFILE_STORAGE_KEY)) !== null, "recovered keyfile not installed");
    },
  },
  {
    name: "installed keyfile unlocks without the file",
    async run({ page, state }) {
      await lockAndReload(page);
      await unlock(page, state, { pickFile: false });
    },
  },
  {
    name: "remove key from the menu",
    async run({ page, state }) {
      await menu(page, "Remove key");
      assert((await storage(page, KEYFILE_STORAGE_KEY)) === null, "keyfile still installed after Remove key");
      await lockAndReload(page);
      await page.getByRole("button", { name: "Choose portunus.key…" }).waitFor();
      // Unlocking with the file installs it again (the checkbox defaults on).
      await fillUnlock(page, state);
      await unlockButton(page).click();
      await vaultOpen(page);
    },
  },
];
