// "Offline mode": with the network gone the vault opens read-only from the
// cached ciphertext and recovers by itself when it's back — unless Drive's
// copy changed meanwhile. With DISABLE_OFFLINE_MODE there is no cache, so an
// offline unlock fails instead.

import {
  ENTRY,
  assert,
  closeEntry,
  lock,
  notesField,
  openEntry,
  openSecondTab,
  save,
  unlock,
  unlockButton,
  fillUnlock,
} from "../helpers.mjs";

const offlinePill = (page) => page.getByText("Offline — read only");

async function unlockOffline(page, state) {
  await lock(page);
  await page.context().setOffline(true);
  await unlock(page, state, { pickFile: false });
  await offlinePill(page).waitFor();
}

export const offlineTests = [
  {
    name: "offline unlock",
    async run({ page, state, offlineCache }) {
      if (!offlineCache) {
        await lock(page);
        await page.context().setOffline(true);
        await fillUnlock(page, state, { pickFile: false });
        await unlockButton(page).click();
        await page.getByText("Unlock failed. Check your connection and try again.").waitFor({ timeout: 30_000 });
        await page.context().setOffline(false);
        await unlockButton(page).click();
        await page.getByPlaceholder("Search entries…").waitFor({ timeout: 60_000 });
        return;
      }
      await unlockOffline(page, state);
      await page.getByText(ENTRY).first().waitFor();
      assert(!(await page.getByRole("button", { name: "+ Add" }).count()), "+ Add offered while offline");
      assert(!(await page.getByRole("button", { name: "Save", exact: true }).count()), "Save offered while offline");
      const row = await openEntry(page, ENTRY);
      assert(await notesField(row).isDisabled(), "entry editable while offline");
      await closeEntry(row);
    },
  },
  {
    name: "offline recovers when the network returns",
    async run({ page, offlineCache }) {
      if (!offlineCache) return;
      await page.context().setOffline(false);
      await page.getByText("Synced").waitFor({ timeout: 45_000 });
      await page.getByRole("button", { name: "+ Add" }).waitFor();
    },
  },
  {
    name: "offline stays read-only when the vault changed meanwhile",
    async run({ page, baseUrl, state, offlineCache }) {
      if (!offlineCache) return;
      await unlockOffline(page, state);
      // Another device (online) saves while this one is offline.
      const tab = await openSecondTab(page, baseUrl, state);
      const theirs = await openEntry(tab.other, ENTRY);
      await notesField(theirs).fill("changed while the other tab was offline");
      await closeEntry(theirs);
      await save(tab.other);
      await tab.close();
      await page.context().setOffline(false);
      await page.getByText("The vault changed on Drive while you were offline").waitFor({ timeout: 45_000 });
      assert(await offlinePill(page).isVisible(), "stale offline copy became writable");
      await lock(page);
      await unlock(page, state, { pickFile: false });
      const row = await openEntry(page, ENTRY);
      const notes = await notesField(row).inputValue();
      assert(notes === "changed while the other tab was offline", `reloaded note says "${notes}"`);
      await closeEntry(row);
    },
  },
];
