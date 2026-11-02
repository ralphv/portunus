// "Entry metadata & password history": timestamps, update count and the
// last 5 previous passwords, derived at save time.

import {
  addEntry,
  assert,
  closeEntry,
  openEntry,
  save,
  setEntryPassword,
} from "../helpers.mjs";

const NAME = "History entry";
const pw = (i) => `history-pw-${i}-Xq7!`;
const CHANGES = 6; // one more than the history keeps

const detail = (row, term) =>
  row.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]");

export const historyTests = [
  {
    name: "password changes are recorded on save",
    async run({ page, state }) {
      let row = await addEntry(page, { name: NAME, password: pw(0) });
      await closeEntry(row);
      await save(page);
      for (let i = 1; i <= CHANGES; i++) {
        row = await openEntry(page, NAME);
        await setEntryPassword(row, pw(i));
        await row.getByText("Password changed — history updates when you save.").waitFor();
        await closeEntry(row);
        await save(page);
      }
      for (let i = 0; i <= CHANGES; i++) state.secrets.push(pw(i));
    },
  },
  {
    name: "item history",
    async run({ page }) {
      const row = await openEntry(page, NAME);
      await row.getByRole("button", { name: /Item History/ }).click();
      const created = await detail(row, "Created").textContent();
      assert(created && created !== "unknown", `no creation time: "${created}"`);
      assert(/ago\)$/.test(await detail(row, "Last password update").textContent()), "no last-update age");
      const count = await detail(row, "Password updates").textContent();
      assert(count === String(CHANGES), `password updates says ${count}, expected ${CHANGES}`);
      // Capped at 5, newest first: pw(5) … pw(1); pw(0) has dropped off.
      await row.getByRole("button", { name: "Previous Passwords (5)" }).click();
      const previous = [];
      for (let i = 1; i <= 5; i++) {
        const mask = row.getByRole("button", { name: `Previous password ${i} (hidden) — click to reveal` });
        await mask.click();
        const input = row.getByLabel(`Previous password ${i}`, { exact: true });
        await input.evaluate((el) => new Promise((r) => {
          const t = setInterval(() => el.value && (clearInterval(t), r()), 20);
        }));
        previous.push(await input.inputValue());
      }
      const expected = [5, 4, 3, 2, 1].map(pw);
      assert(
        JSON.stringify(previous) === JSON.stringify(expected),
        `previous passwords ${JSON.stringify(previous)}, expected ${JSON.stringify(expected)}`,
      );
      await closeEntry(row);
    },
  },
];
