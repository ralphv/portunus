// "Have I Been Pwned checks" against the stubbed range API (network.mjs):
// the on-edit check, its Settings toggle, the menu audit, and that only a
// 5-character hash prefix leaves the browser.

import {
  addEntry,
  assert,
  closeEntry,
  entryRow,
  menu,
  openEntry,
  save,
  setEntryPassword,
} from "../helpers.mjs";
import { BREACH_COUNT, BREACHED_PASSWORD } from "../network.mjs";

const hibpToggle = (page) => page.getByLabel("Have I Been Pwned on edit");
const pwnedChip = (row) => row.getByText("pwned", { exact: true }).first();

async function setHibpOnEdit(page, on) {
  await menu(page, "Settings");
  await hibpToggle(page).setChecked(on);
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Done" }).click();
}

export const hibpTests = [
  {
    name: "breach check on password edit",
    async run({ page, state }) {
      const before = state.hibpRequests.length;
      const row = await addEntry(page, { name: "Weak entry" });
      await setEntryPassword(row, BREACHED_PASSWORD);
      await row.getByText("Very weak").waitFor({ timeout: 30_000 });
      await row
        .getByText(`Seen ${BREACH_COUNT.toLocaleString("en-US")} times in breaches — change this password`)
        .waitFor({ timeout: 15_000 });
      await row.getByRole("button", { name: "Remove label pwned" }).waitFor();
      assert(state.hibpRequests.length > before, "no request reached the (stubbed) Pwned Passwords API");
      await closeEntry(row);
      await pwnedChip(entryRow(page, "Weak entry")).waitFor();
    },
  },
  {
    name: "only a 5-character hash prefix is sent",
    async run({ state }) {
      assert(state.hibpRequests.length > 0, "no Pwned Passwords requests recorded");
      for (const { url, headers } of state.hibpRequests) {
        assert(/\/range\/[0-9A-F]{5}$/.test(url), `unexpected Pwned Passwords URL: ${url}`);
        assert(headers["add-padding"] === "true", "request without Add-Padding");
        assert(!headers.cookie && !headers.referer, "request carries a cookie or referrer");
      }
    },
  },
  {
    name: "on-edit check can be turned off",
    async run({ page, state }) {
      await setHibpOnEdit(page, false);
      const before = state.hibpRequests.length;
      const row = await openEntry(page, "Notion");
      await setEntryPassword(row, BREACHED_PASSWORD);
      await page.waitForTimeout(2_000); // past the 800 ms debounce
      assert(state.hibpRequests.length === before, "breach check ran with the setting off");
      await closeEntry(row);
      assert(!(await pwnedChip(entryRow(page, "Notion")).count()), "Notion marked pwned without a check");
    },
  },
  {
    name: "breach audit from the menu",
    async run({ page }) {
      await menu(page, "Have I Been Pwned");
      const dialog = page.getByRole("dialog", { name: "Have I Been Pwned check" });
      // Distinct passwords: Smoke entry, GitHub, History entry, and the one
      // Weak entry and Notion share — checked once, marked on both.
      await dialog.getByText("4 / 4 checked").waitFor({ timeout: 30_000 });
      await dialog.getByText(/1 of 4 passwords found in breaches/).waitFor();
      await dialog.getByRole("button", { name: "Close" }).click();
      await pwnedChip(entryRow(page, "Notion")).waitFor();
      assert(!(await pwnedChip(entryRow(page, "GitHub")).count()), "GitHub marked pwned");
    },
  },
  {
    name: "breach results and setting saved",
    async run({ page }) {
      await setHibpOnEdit(page, true);
      await save(page);
    },
  },
];
