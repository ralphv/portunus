// "Themes", "Auto-lock" (incl. the Lock button) and sign-out. Auto-lock fakes
// the page clock, so it runs last: from then on the page's time is ahead of real time.

import {
  DEMO_EMAIL,
  ENTRY,
  THEME_STORAGE_KEY,
  assert,
  closeEntry,
  lockButton,
  notesField,
  openEntry,
  save,
  saveButton,
  storage,
  unlock,
  unlockHeading,
  vaultOpen,
} from "../helpers.mjs";

const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme ?? "original");
const themeButton = (page, label) =>
  page.getByRole("group", { name: "Theme" }).getByRole("button", { name: label, exact: true });
const pill = (page) => page.getByText(/^(locks in \d+:\d\d|auto-lock paused)$/);

export const sessionTests = [
  {
    name: "account shown in the menu",
    async run({ page }) {
      await page.getByRole("button", { name: "Menu" }).click();
      await page.getByRole("menu").getByText(DEMO_EMAIL).waitFor();
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "Save shown only when unsaved, Lock beside it",
    async run({ page, state }) {
      // Lock is its own icon button next to Save, no longer a menu item.
      await page.getByRole("button", { name: "Menu" }).click();
      await page.getByRole("menu").waitFor();
      assert(!(await page.getByRole("menuitem", { name: "Lock" }).count()), "Lock still in the menu");
      await page.keyboard.press("Escape");
      // Nothing unsaved: Save is hidden, Lock is still there.
      assert(!(await saveButton(page).count()), "Save shown with nothing to save");
      assert(await lockButton(page).isVisible(), "Lock button missing");
      // An unsaved edit brings Save back, with Lock right after it.
      const row = await openEntry(page, ENTRY);
      await notesField(row).fill("lock asks first");
      await closeEntry(row);
      const saveBox = await saveButton(page).boundingBox();
      const lockBox = await lockButton(page).boundingBox();
      assert(saveBox && lockBox, "Save or Lock button missing with unsaved changes");
      assert(lockBox.x >= saveBox.x + saveBox.width && lockBox.x - (saveBox.x + saveBox.width) < 24, "Lock isn't right after Save");
      // Declining the "lock anyway?" confirm keeps the vault open. The
      // stub counts its calls (so the confirm was really asked) and is
      // restored even if the click throws, since later steps rely on the
      // runner's accept-every-dialog handler.
      await page.evaluate(() => {
        window.__smokeConfirm = window.confirm;
        window.__smokeConfirmCalls = 0;
        window.confirm = () => {
          window.__smokeConfirmCalls++;
          return false;
        };
      });
      let confirmCalls;
      try {
        await lockButton(page).click();
      } finally {
        confirmCalls = await page.evaluate(() => {
          window.confirm = window.__smokeConfirm;
          return window.__smokeConfirmCalls;
        });
      }
      assert(confirmCalls === 1, `Lock asked ${confirmCalls} times before locking unsaved changes, expected 1`);
      assert(!(await unlockHeading(page).count()), "locked although the confirm was declined");
      await page.getByRole("status").filter({ hasText: "Unsaved changes" }).waitFor();
      // Saving hides Save again, moves focus to Lock (not <body>) and the
      // status (a live region) reads "Synced".
      await save(page);
      await page.getByRole("status").filter({ hasText: "Synced" }).waitFor();
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      assert(focused === "Lock", `focus after saving is on ${focused ?? "<body>"}, expected Lock`);
      // With unsaved changes again, accepting the confirm locks (the edit
      // is dropped).
      const again = await openEntry(page, ENTRY);
      await notesField(again).fill("lock asks first, again");
      await closeEntry(again);
      await lockButton(page).click();
      await unlockHeading(page).waitFor();
      await unlock(page, state, { pickFile: false });
      assert(await lockButton(page).isVisible(), "Lock button missing after unlock");
    },
  },
  {
    name: "themes, remembered per browser",
    async run({ page, state }) {
      for (const [label, id] of [["Light", "light"], ["Dark", "dark"]]) {
        await themeButton(page, label).click();
        assert((await theme(page)) === id, `${label} theme not applied`);
        assert((await themeButton(page, label).getAttribute("aria-pressed")) === "true", `${label} not marked active`);
      }
      assert((await storage(page, THEME_STORAGE_KEY)) === "dark", "theme not stored");
      await page.reload();
      await unlockHeading(page).waitFor({ timeout: 30_000 });
      assert((await theme(page)) === "dark", "theme lost on reload");
      await themeButton(page, "Original").click();
      assert((await theme(page)) === "original", "Original theme not restored");
      await unlock(page, state, { pickFile: false });
    },
  },
  {
    name: "auto-lock countdown, paused while unsaved",
    async run({ page, state }) {
      // Fake timers from here on; reload so the app starts under them.
      await page.clock.install();
      await page.reload();
      await unlockHeading(page).waitFor({ timeout: 30_000 });
      await unlock(page, state, { pickFile: false });
      assert(/^locks in [45]:\d\d$/.test(await pill(page).textContent()), "no auto-lock countdown");
      await page.clock.fastForward("04:00");
      await page.getByText(/^locks in 0:[5-9]\d$|^locks in 1:00$/).waitFor();
      // Activity resets it.
      await page.mouse.move(10, 10);
      await page.mouse.move(200, 200);
      await page.clock.fastForward(1_000);
      await page.getByText(/^locks in 4:5\d$/).waitFor();
      // Unsaved changes pause it — well past the limit, still open.
      const row = await openEntry(page, ENTRY);
      await notesField(row).fill("auto-lock waits for this");
      await closeEntry(row);
      await page.getByText("auto-lock paused").waitFor();
      await page.clock.fastForward("06:00");
      assert(!(await unlockHeading(page).count()), "auto-locked with unsaved changes");
      await vaultOpen(page);
    },
  },
  {
    name: "auto-lock locks when idle",
    async run({ page }) {
      await save(page);
      await page.getByText(/^locks in \d+:\d\d$/).waitFor();
      await page.clock.fastForward("05:01");
      await unlockHeading(page).waitFor({ timeout: 10_000 });
    },
  },
  {
    name: "sign out",
    async run({ page }) {
      await page.getByText(`Signed in as ${DEMO_EMAIL}`).waitFor();
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.getByRole("button", { name: "Sign in with Google" }).waitFor({ timeout: 30_000 });
    },
  },
];
