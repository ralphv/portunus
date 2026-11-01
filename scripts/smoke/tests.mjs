// The smoke tests themselves, shared by every harness (scripts/smoke/smoke.mjs,
// scripts/smoke/full-smoke.mjs). They run in order against one page and build on
// each other — a failure stops the rest. `ctx` carries:
//   page     Playwright page (fresh context → fresh demo vault)
//   baseUrl  server under test
//   workDir  temp dir for downloads (deleted after a passing run)
//   state    scratch object tests use to hand data to later tests
//
// Add a test by appending { name, run } — the runner reports each name as it
// goes and fails on any page error, console error or unexpected HTTP error.

import { join } from "node:path";

const PASSWORD = "correct horse battery staple";
const ENTRY = "Smoke entry";

// Entry-editor labels aren't for-associated — select by label text.
const field = (row, label) =>
  row.locator(
    `xpath=.//label[normalize-space()='${label}']/following-sibling::div[1]//input[1]`,
  );

export const tests = [
  {
    name: "sign in",
    async run({ page, baseUrl }) {
      await page.goto(baseUrl);
      await page.getByRole("button", { name: "Sign in with Google" }).click();
      await page.getByRole("heading", { name: "Create your vault" }).waitFor({ timeout: 30_000 });
    },
  },
  {
    name: "create vault",
    async run({ page, workDir, state }) {
      const pw = page.locator('input[type="password"]');
      await pw.nth(0).fill(PASSWORD);
      await pw.nth(1).fill(PASSWORD);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { name: "Save your keyfile" }).waitFor();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Download portunus.key" }).click(),
      ]);
      state.keyfilePath = join(workDir, "portunus.key");
      await download.saveAs(state.keyfilePath);
      // Not installed, so the unlock test below exercises the file picker.
      await page.getByLabel("Also install the keyfile in this browser").uncheck();
      await page.getByLabel(/I have saved the keyfile/).check();
      await page.getByRole("button", { name: "Create vault" }).click();
      await page.getByPlaceholder("Search entries…").waitFor({ timeout: 60_000 });
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
    name: "reload + unlock with keyfile",
    async run({ page, state }) {
      await page.reload();
      await page.getByRole("heading", { name: "Unlock vault" }).waitFor({ timeout: 30_000 });
      await page.locator('input[type="password"]').fill(PASSWORD);
      await page.locator('input[type="file"]').setInputFiles(state.keyfilePath);
      await page.getByText(/^Key .+ loaded$/).waitFor();
      await page.getByRole("button", { name: "Unlock", exact: true }).click();
      await page.getByPlaceholder("Search entries…").waitFor({ timeout: 60_000 });
    },
  },
  {
    name: "entry persisted",
    async run({ page }) {
      await page.getByText(ENTRY).first().waitFor();
    },
  },
];
