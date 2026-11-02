// "Secrets rendered on demand" and "Vault isolated in a Web Worker".

import {
  assert,
  closeEntry,
  field,
  lock,
  openEntry,
  passwordInput,
  passwordMask,
  revealPassword,
  unlock,
} from "../helpers.mjs";

const MASK = "••••••••";

async function expectMasked(page, row, secret) {
  await passwordMask(row).waitFor({ timeout: 35_000 });
  assert((await passwordMask(row).textContent()) === MASK, "mask isn't the fixed-length ••••••••");
  assert(!(await passwordInput(row).count()), "an <input> still holds the masked password");
  assert(!(await page.content()).includes(secret), "masked password appears in the page HTML");
}

// Dedicated workers except qr-scanner's blob: one.
const appWorkers = (page) => page.workers().filter((w) => !w.url().startsWith("blob:"));

export const secretTests = [
  {
    name: "passwords masked until revealed",
    async run({ page, state }) {
      const row = await openEntry(page, "GitHub");
      await expectMasked(page, row, state.githubPassword);
      const shown = await revealPassword(row);
      assert(shown === state.githubPassword, "show revealed a different password");
      const input = passwordInput(row);
      assert((await input.getAttribute("type")) === "text", "show didn't switch the input to text");
      assert((await input.getAttribute("value")) === null, "revealed password is in a value attribute");
      assert(!(await page.content()).includes(shown), "revealed password appears in the page HTML");
    },
  },
  {
    name: "re-masks when focus leaves the field",
    async run({ page, state }) {
      const row = page.locator('li[id^="entry-"]').first();
      await field(row, "Name").click();
      await expectMasked(page, row, state.githubPassword);
    },
  },
  {
    name: "re-masks after 30 s idle",
    async run({ page, state }) {
      const row = page.locator('li[id^="entry-"]').first();
      await revealPassword(row);
      await page.waitForTimeout(31_000);
      await expectMasked(page, row, state.githubPassword);
      await closeEntry(row);
    },
  },
  {
    name: "vault worker ends on lock",
    async run({ page, state }) {
      const workers = appWorkers(page);
      assert(workers.length >= 1, "no vault Worker while unlocked");
      const closed = Promise.all(workers.map((w) => new Promise((r) => w.once("close", r))));
      await lock(page);
      await Promise.race([
        closed,
        new Promise((_, reject) => setTimeout(() => reject(new Error("vault Worker still running after Lock")), 5_000)),
      ]);
      await unlock(page, state, { pickFile: false });
    },
  },
];
