// Shared constants and UI moves for the smoke tests (scripts/smoke/tests/*).
// Everything here drives the real UI through Playwright; nothing reaches
// into app code.

import { readFileSync } from "node:fs";
import { blockExternalRequests, installHibpStub } from "./network.mjs";

export const PASSWORD = "correct horse battery staple";
export const NEW_PASSWORD = "a different horse entirely";
export const ENTRY = "Smoke entry";
export const DEMO_EMAIL = "demo@portunus.local";

// localStorage slots (src/constants.ts, src/lib/theme.ts).
export const VAULT_CACHE_KEY = "portunus.vault.cache";
export const KEYFILE_STORAGE_KEY = "portunus.keyfile";
export const ENTRY_SORT_KEY = "portunus.entry-sort";
export const THEME_STORAGE_KEY = "portunus-theme";

export function assert(cond, message) {
  if (!cond) throw new Error(message);
}

export const storage = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

export const keyOf = (keyfilePath) => JSON.parse(readFileSync(keyfilePath, "utf8")).key;

// Entry-editor labels aren't for-associated — select by label text.
export const field = (row, label) =>
  row.locator(
    `xpath=.//label[normalize-space()='${label}']/following-sibling::div[1]//input[1]`,
  );
export const notesField = (row) =>
  row.locator("xpath=.//label[normalize-space()='Notes']/following-sibling::textarea");

// Its placeholder changes with focus, so locate it by its label.
export const searchBox = (page) => page.getByRole("searchbox", { name: "Search entries" });
export const vaultOpen = (page) => searchBox(page).waitFor({ timeout: 60_000 });

export const unlockButton = (page) => page.getByRole("button", { name: "Unlock", exact: true });
export const unlockHeading = (page) => page.getByRole("heading", { name: "Unlock vault" });
export const entryCount = (page) => page.locator("#entry-count");

export async function menu(page, item) {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

export async function openSecurity(page) {
  await menu(page, "Security");
  await page.getByRole("heading", { name: "Security" }).waitFor();
}

export const closeSecurity = (page) => page.getByRole("button", { name: "✕" }).click();

export async function lock(page) {
  await menu(page, "Lock");
  await unlockHeading(page).waitFor();
}

// Lock, then reload so the keyfile (kept in React state across a lock) is
// gone and the unlock screen starts from scratch, as in a new session.
export async function lockAndReload(page) {
  await lock(page);
  await page.reload();
  await unlockHeading(page).waitFor({ timeout: 30_000 });
}

// Fills the unlock form. `pickFile` chooses the keyfile in the file picker;
// without it the form must already show a loaded key (installed keyfile).
export async function fillUnlock(page, state, { password = PASSWORD, pickFile = true } = {}) {
  await page.locator('input[type="password"]').fill(password);
  if (pickFile) await page.locator('input[type="file"]').setInputFiles(state.keyfilePath);
  await page.getByText(/^Key .+ loaded$/).waitFor();
}

export async function unlock(page, state, opts) {
  await fillUnlock(page, state, opts);
  await unlockButton(page).click();
  await vaultOpen(page);
}

// From the "Create your vault" screen: password twice, download the keyfile
// into `path`, optionally install it, then Create vault. Returns the
// recovery code shown on the keyfile step.
export async function createVault(page, path, { install }) {
  const pw = page.locator('input[type="password"]');
  await pw.nth(0).fill(PASSWORD);
  await pw.nth(1).fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Save your keyfile" }).waitFor();
  const code = page.getByText(/^[0-9A-Z]{4,}(-[0-9A-Z]+)+$/);
  await code.waitFor({ timeout: 30_000 });
  const recoveryCode = (await code.textContent()).trim();
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
  return recoveryCode;
}

// Every password input in `scope` has its own show/hide eye that reveals it
// (type="text", still no value attribute) and masks it again. Returns how
// many password inputs there were.
export async function assertPasswordsRevealable(scope, where) {
  const n = await scope.locator('input[type="password"]').count();
  const eyes = scope.getByRole("button", { name: "Show password", exact: true });
  assert(n > 0, `${where}: no password field`);
  assert((await eyes.count()) === n, `${where}: ${n} password fields but ${await eyes.count()} show/hide buttons`);
  for (let i = 0; i < n; i++) {
    // Handles, not locators: the button's name flips to "Hide password".
    const eye = await eyes.nth(i).elementHandle();
    const input = await eyes.nth(i).locator("xpath=preceding-sibling::input[1]").elementHandle();
    await eye.click();
    assert((await input.getAttribute("type")) === "text", `${where}: Show password didn't reveal field ${i + 1}`);
    assert((await input.getAttribute("value")) === null, `${where}: revealed field ${i + 1} has a value attribute`);
    await eye.click();
    assert((await input.getAttribute("type")) === "password", `${where}: Hide password didn't mask field ${i + 1}`);
  }
  return n;
}

export const saveDialog = (page) =>
  page.getByRole("heading", { name: "Confirm master password to save" }).locator("..");
export const saveDialogPassword = (page) => saveDialog(page).locator('input[type="password"]');
export const saveButton = (page) => page.getByRole("button", { name: "Save", exact: true });

// Save → re-enter the master password → Save to Drive, then wait until
// nothing is dirty any more. A silent breach-check result that lands while
// the save is in flight is kept as a new unsaved change on purpose
// (saveWith in src/components/vault-open.tsx), so one more save may be due.
export async function save(page, password = PASSWORD) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await saveButton(page).click();
    await saveDialogPassword(page).fill(password);
    await page.getByRole("button", { name: "Save to Drive" }).click();
    await saveDialog(page).waitFor({ state: "detached", timeout: 60_000 });
    const clean = saveButton(page).and(page.locator(":disabled"));
    if (await clean.waitFor({ timeout: 3_000 }).then(() => true, () => false)) return;
  }
  throw new Error("vault still has unsaved changes after saving twice");
}

// --- Entries ---

export const entryRows = (page) => page.locator('li[id^="entry-"]');

// An entry by its displayed name, collapsed or open.
export const entryRow = (page, name) =>
  entryRows(page).filter({
    has: page.locator(`button[aria-label="Expand ${name}"], button[aria-label="Collapse ${name}"]`),
  });

// The entry list's names in display order.
export const entryNames = (page) =>
  page
    .locator('li[id^="entry-"] button[aria-label^="Expand "], li[id^="entry-"] button[aria-label^="Collapse "]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label").replace(/^(Expand|Collapse) /, "")));

export async function openEntry(page, name) {
  await page.getByRole("button", { name: `Expand ${name}`, exact: true }).click();
  return entryRow(page, name);
}

// The entry's own Done (the two-factor field has a Done of its own, earlier
// in the row).
export const closeEntry = (row) => row.getByRole("button", { name: "Done", exact: true }).last().click();

// "+ Add" opens a blank entry at the top; returns a locator pinned to its id
// so it survives the name (and the row's aria-labels) changing.
export async function addEntry(page, { name, username, email, url, notes, password, generate } = {}) {
  await page.getByRole("button", { name: "+ Add" }).click();
  const id = await entryRows(page).first().getAttribute("id");
  const row = page.locator(`#${id}`);
  if (name !== undefined) await field(row, "Name").fill(name);
  if (username !== undefined) await field(row, "Username").fill(username);
  if (email !== undefined) await field(row, "Email").fill(email);
  if (url !== undefined) await field(row, "URL").fill(url);
  if (notes !== undefined) await notesField(row).fill(notes);
  if (password !== undefined) await setEntryPassword(row, password);
  if (generate) await row.getByRole("button", { name: "Generate" }).click();
  return row;
}

export const passwordMask = (row) => row.getByRole("button", { name: /^Password \(hidden\)/ });
export const passwordInput = (row) => row.getByLabel("Password", { exact: true });
export const showToggle = (row) =>
  row.locator("[data-secret-scope]").getByRole("button", { name: /^(show|hide)$/ });

// Resolves once an input's value has been loaded from the vault Worker.
export const waitForValue = (input) =>
  input.evaluate(
    (el) =>
      new Promise((resolve) => {
        const t = setInterval(() => {
          if (el.value) {
            clearInterval(t);
            resolve();
          }
        }, 20);
      }),
  );

// Types a new password into an entry (opening the masked field first when
// it already holds one), then moves focus to Name so the field re-masks and
// any on-edit breach check fires.
export async function setEntryPassword(row, password) {
  if (await passwordMask(row).count()) {
    await passwordMask(row).click();
    await waitForValue(passwordInput(row));
  }
  await passwordInput(row).fill(password);
  await field(row, "Name").click();
}

// Reveals the entry's password with "show" and returns it.
export async function revealPassword(row) {
  await showToggle(row).click();
  const input = passwordInput(row);
  await waitForValue(input);
  return input.inputValue();
}

export const clipboardText = (page) => page.evaluate(() => navigator.clipboard.readText());

// --- A second, independent browser tab on the same account and vault ---

// Another browser context with this one's cookies and localStorage, so it
// signs in as the same demo visitor (same vault) and finds the installed
// keyfile. It gets the same network guard and Pwned Passwords stub; a
// blocked request fails close(). Not watched by the runner's other checks.
export async function openSecondTab(page, baseUrl, state) {
  const context = await page.context().browser().newContext({
    storageState: await page.context().storageState(),
  });
  const blocked = [];
  await blockExternalRequests(context, baseUrl, (msg) => blocked.push(msg));
  await installHibpStub(context, state);
  const other = await context.newPage();
  other.on("dialog", (d) => d.accept());
  await other.goto(baseUrl);
  await unlockHeading(other).waitFor({ timeout: 30_000 });
  const keyLoaded = await other.getByText(/^Key .+ loaded$/).count();
  await unlock(other, state, { pickFile: !keyLoaded });
  return {
    other,
    async close() {
      await context.close();
      if (blocked.length) throw new Error(`second tab: ${blocked.join("; ")}`);
    },
  };
}
