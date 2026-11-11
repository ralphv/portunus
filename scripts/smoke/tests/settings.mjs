// "Synced settings" (stored in the encrypted vault, so they survive a reload)
// and "Save protection" (password re-entry, conflict detection).

import {
  ENTRY,
  PASSWORD,
  assert,
  closeEntry,
  entryRows,
  lock,
  lockAndReload,
  menu,
  notesField,
  openEntry,
  openSecondTab,
  save,
  saveButton,
  saveDialog,
  saveDialogPassword,
  unlock,
  unlockHeading,
  assertPasswordsRevealable,
} from "../helpers.mjs";

const ALL = 6; // entries in the vault at this point

async function setSetting(page, label, on) {
  await menu(page, "Settings");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByLabel(label).setChecked(on);
  await dialog.getByRole("button", { name: "Done" }).click();
}

async function settingChecked(page, label) {
  await menu(page, "Settings");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const on = await dialog.getByLabel(label).isChecked();
  await dialog.getByRole("button", { name: "Done" }).click();
  return on;
}

async function visibleRows(page) {
  return entryRows(page).count();
}

const autocompleteOf = (input) => input.getAttribute("autocomplete");

export const settingsTests = [
  {
    name: "focus mode is on by default",
    async run({ page }) {
      assert(await settingChecked(page, "Focus mode"), "Focus mode not on by default");
      const row = await openEntry(page, "GitHub");
      assert((await visibleRows(page)) === 1, "focus mode lists other entries while editing");
      await closeEntry(row);
      assert((await visibleRows(page)) === ALL, "the list didn't come back after Done");
    },
  },
  {
    name: "focus mode off keeps the whole list",
    async run({ page }) {
      await setSetting(page, "Focus mode", false);
      const row = await openEntry(page, "GitHub");
      assert((await visibleRows(page)) === ALL, "focus mode off still hides entries");
      await closeEntry(row);
    },
  },
  {
    name: "password autofill suppressed by default",
    async run({ page }) {
      // The settings change made the vault dirty, so Save opens.
      await saveButton(page).click();
      const input = saveDialogPassword(page);
      assert((await autocompleteOf(input)) === "new-password", "save dialog invites password autofill");
      assert((await input.getAttribute("data-1p-ignore")) !== null, "no password-manager ignore flags");
      await assertPasswordsRevealable(saveDialog(page), "save dialog");
      await input.fill(PASSWORD);
      await page.getByRole("button", { name: "Save to Drive" }).click();
      await saveButton(page).and(page.locator(":disabled")).waitFor({ timeout: 60_000 });
    },
  },
  {
    name: "settings survive a reload",
    async run({ page, state }) {
      await lockAndReload(page);
      await unlock(page, state, { pickFile: false });
      assert(!(await settingChecked(page, "Focus mode")), "Focus mode setting lost on reload");
      await setSetting(page, "Focus mode", true);
      await save(page);
    },
  },
  {
    name: "password fill & save setting",
    async run({ page, state }) {
      await setSetting(page, "Browser password fill & save", true);
      await saveButton(page).click();
      assert((await autocompleteOf(saveDialogPassword(page))) === "current-password", "fill & save on, but autofill still off");
      await saveDialogPassword(page).fill(PASSWORD);
      await page.getByRole("button", { name: "Save to Drive" }).click();
      await saveButton(page).and(page.locator(":disabled")).waitFor({ timeout: 60_000 });
      // The unlock screen, rendered before the vault is readable, follows
      // the device's mirror of the setting.
      await lockAndReload(page);
      await page.getByText(/^Key .+ loaded$/).waitFor();
      assert((await autocompleteOf(page.locator('input[type="password"]'))) === "current-password", "unlock screen ignores fill & save");
      await unlock(page, state, { pickFile: false });
      await setSetting(page, "Browser password fill & save", false);
      await save(page);
      await lockAndReload(page);
      await page.getByText(/^Key .+ loaded$/).waitFor();
      assert((await autocompleteOf(page.locator('input[type="password"]'))) === "new-password", "unlock screen still offers autofill");
      await unlock(page, state, { pickFile: false });
    },
  },
  {
    name: "save needs the master password",
    async run({ page }) {
      const row = await openEntry(page, ENTRY);
      await notesField(row).fill("saved with the right password");
      await closeEntry(row);
      await saveButton(page).click();
      await saveDialogPassword(page).fill("not the master password");
      await page.getByRole("button", { name: "Save to Drive" }).click();
      await page.getByText("Wrong password.").waitFor({ timeout: 30_000 });
      await saveDialogPassword(page).fill(PASSWORD);
      await page.getByRole("button", { name: "Save to Drive" }).click();
      await saveButton(page).and(page.locator(":disabled")).waitFor({ timeout: 60_000 });
    },
  },
  {
    name: "concurrent write is detected",
    allowHttp: [{ status: 409, method: "PUT", path: "/api/vault" }],
    async run({ page, baseUrl, state }) {
      // Another tab saves first…
      const tab = await openSecondTab(page, baseUrl, state);
      const theirs = await openEntry(tab.other, ENTRY);
      await notesField(theirs).fill("edited in another tab");
      await closeEntry(theirs);
      await save(tab.other);
      await tab.close();
      // …so this tab's save, based on the older copy, is refused.
      const row = await openEntry(page, ENTRY);
      await notesField(row).fill("edited in this tab");
      await closeEntry(row);
      await saveButton(page).click();
      await saveDialogPassword(page).fill(PASSWORD);
      await page.getByRole("button", { name: "Save to Drive" }).click();
      await page.getByText("The vault changed elsewhere since you unlocked it.", { exact: false }).waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "Cancel" }).click();
      // Lock (confirming the unsaved-changes prompt) and reload Drive's copy.
      await lock(page);
      await unlockHeading(page).waitFor();
      await unlock(page, state, { pickFile: false });
      const reloaded = await openEntry(page, ENTRY);
      const notes = await notesField(reloaded).inputValue();
      assert(notes === "edited in another tab", `after reload the note says "${notes}"`);
      await closeEntry(reloaded);
    },
  },
];
