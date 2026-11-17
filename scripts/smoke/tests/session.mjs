// "Themes", "Auto-lock" (incl. the Lock button), "Hidden-page lock" and
// sign-out. Auto-lock fakes the page clock, so it runs last: from then on the
// page's time is ahead of real time.

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

const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme ?? "system");
const bodyBackground = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
// Every <meta name="theme-color"> as "media=content", in document order.
const themeColors = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => `${m.media}=${m.content}`),
  );
// The colour the browser uses for its chrome: the first theme-color meta
// whose media matches (or that has none).
const effectiveThemeColor = (page) =>
  page.evaluate(() => {
    const m = [...document.querySelectorAll('meta[name="theme-color"]')].find(
      (el) => !el.media || matchMedia(el.media).matches,
    );
    return m?.content.toLowerCase() ?? null;
  });
// "rgb(r, g, b)" → "#rrggbb", to compare a computed colour with a meta's.
const toHex = (rgb) =>
  "#" + rgb.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
// Each scheme's surface colour, read from the page itself (body background)
// so the step doesn't depend on the palette (src/app/palette.css).
const THEME_COLOR = {};
const themeButton = (page, label) =>
  page.getByRole("group", { name: "Theme" }).getByRole("button", { name: label, exact: true });
const pill = (page) => page.getByText(/^(locks in \d+:\d\d|auto-lock paused)$/);

// Hidden-page lock (src/components/hidden-cover.tsx). Headless pages are
// never really hidden, so the page's visibility is faked: the getters are
// overridden and a visibilitychange is dispatched, as a browser would.
const HIDDEN_COVER_CAPTION = "Hidden while you're away";
async function setHidden(page, hidden) {
  await page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}
const cover = (page) => page.locator("[data-hidden-cover]");
// The vault (its search box stands in for all of it) sits under an inert root.
const vaultInert = (page) =>
  page.evaluate(() => Boolean(document.querySelector('input[type="search"]')?.closest("[inert]")));
const isLocked = async (page) => (await unlockHeading(page).count()) > 0;
// Hidden, well past the grace period, yet still open (cover up), then back.
async function expectNoLockWhileHidden(page, grace, why) {
  await setHidden(page, true);
  await cover(page).waitFor();
  await page.clock.fastForward((grace + 5) * 1000);
  assert(!(await isLocked(page)), `locked while hidden despite ${why}`);
  assert(await cover(page).isVisible(), `cover gone while hidden (${why})`);
  await setHidden(page, false);
  await cover(page).waitFor({ state: "detached" });
  await vaultOpen(page);
}

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
      // Lock is filled like Save and "Unlock with biometrics" (primary, on-primary icon).
      const colors = (loc) =>
        loc.evaluate((el) => {
          const cs = getComputedStyle(el);
          return `${cs.backgroundColor} / ${cs.color}`;
        });
      const lockColors = await colors(lockButton(page));
      const saveColors = await colors(saveButton(page));
      assert(lockColors === saveColors, `Lock is ${lockColors}, expected Save's ${saveColors}`);
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
      // Material 3 light and dark schemes: each sets <html data-theme>
      // and really changes the page's surface colour.
      const surfaces = {};
      for (const [label, id] of [["Light", "light"], ["Dark", "dark"]]) {
        await themeButton(page, label).click();
        assert((await theme(page)) === id, `${label} theme not applied`);
        assert((await themeButton(page, label).getAttribute("aria-pressed")) === "true", `${label} not marked active`);
        surfaces[id] = await bodyBackground(page);
        THEME_COLOR[id] = toHex(surfaces[id]);
        // An explicit choice also colours the browser / PWA chrome…
        assert((await effectiveThemeColor(page)) === THEME_COLOR[id], `${label}: theme-color is ${await themeColors(page)}`);
        // …whatever the OS prefers.
        const otherOs = id === "light" ? "dark" : "light";
        try {
          await page.emulateMedia({ colorScheme: otherOs });
          assert((await effectiveThemeColor(page)) === THEME_COLOR[id], `${label} on a ${otherOs} OS: theme-color is ${await themeColors(page)}`);
        } finally {
          await page.emulateMedia({ colorScheme: "light" });
        }
      }
      assert(surfaces.light !== surfaces.dark, `Light and Dark share the surface colour ${surfaces.light}`);
      assert((await storage(page, THEME_STORAGE_KEY)) === "dark", "theme not stored");
      await page.reload();
      await unlockHeading(page).waitFor({ timeout: 30_000 });
      assert((await theme(page)) === "dark", "theme lost on reload");
      assert((await effectiveThemeColor(page)) === THEME_COLOR.dark, `theme-color after reload is ${await themeColors(page)}`);
      // System (the default) sets no data-theme and follows the OS scheme.
      await themeButton(page, "System").click();
      assert((await theme(page)) === "system", "System theme not restored");
      assert((await themeButton(page, "System").getAttribute("aria-pressed")) === "true", "System not marked active");
      // System follows the OS for the page and the browser chrome alike.
      try {
        await page.emulateMedia({ colorScheme: "dark" });
        assert((await bodyBackground(page)) === surfaces.dark, "System ignores an OS dark preference");
        assert((await effectiveThemeColor(page)) === THEME_COLOR.dark, `System on a dark OS: theme-color is ${await themeColors(page)}`);
        await page.emulateMedia({ colorScheme: "light" });
        assert((await bodyBackground(page)) === surfaces.light, "System ignores an OS light preference");
        assert((await effectiveThemeColor(page)) === THEME_COLOR.light, `System on a light OS: theme-color is ${await themeColors(page)}`);
      } finally {
        // Back to the context's default scheme (light), not "no emulation":
        // a HEADED run on a dark-OS machine would otherwise go on in dark.
        await page.emulateMedia({ colorScheme: "light" });
      }
      // The retired "original" theme, still stored by older versions,
      // falls back to System after a reload.
      await page.evaluate((k) => localStorage.setItem(k, "original"), THEME_STORAGE_KEY);
      await page.reload();
      await unlockHeading(page).waitFor({ timeout: 30_000 });
      assert((await theme(page)) === "system", "a stored \"original\" theme set a data-theme");
      assert((await themeButton(page, "System").getAttribute("aria-pressed")) === "true", "System not active for a stored \"original\" theme");
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
    name: "hidden page: blurred lock cover, gone on return",
    async run({ page, state, hiddenLockSeconds: grace }) {
      assert(grace >= 2, "these steps need PORTUNUS_HIDDEN_LOCK_SECONDS >= 2");
      await unlock(page, state, { pickFile: false });
      assert(!(await cover(page).count()), "cover shown while the page is visible");
      assert(!(await vaultInert(page)), "vault inert while the page is visible");
      await setHidden(page, true);
      await cover(page).waitFor();
      await cover(page).getByRole("status").filter({ hasText: HIDDEN_COVER_CAPTION }).waitFor();
      // Everything under the cover — the vault and the footer — heavily blurred.
      for (const tag of ["main", "footer"]) {
        const blur = await page.locator(tag).evaluate((el) => getComputedStyle(el).filter);
        assert(/blur\(2\dpx\)/.test(blur), `${tag} isn't heavily blurred under the cover (filter: ${blur})`);
      }
      assert(await vaultInert(page), "vault not inert under the cover");
      // Just inside the grace period: still open.
      await page.clock.fastForward((grace - 1) * 1000);
      assert(!(await isLocked(page)), "locked before the grace period ended");
      await setHidden(page, false);
      await cover(page).waitFor({ state: "detached" });
      assert(!(await vaultInert(page)), "vault still inert after coming back");
      const after = await page.locator("main").evaluate((el) => getComputedStyle(el).filter);
      assert(after === "none", `vault still blurred after coming back (filter: ${after})`);
      await vaultOpen(page);
    },
  },
  {
    name: "hidden page: unsaved changes keep it unlocked",
    async run({ page, hiddenLockSeconds: grace }) {
      const row = await openEntry(page, ENTRY);
      await notesField(row).fill("hidden-page lock waits for this");
      await closeEntry(row);
      await saveButton(page).waitFor();
      await expectNoLockWhileHidden(page, grace, "unsaved changes");
      await save(page);
    },
  },
  {
    name: "hidden page: an open file picker keeps it unlocked",
    async run({ page, hiddenLockSeconds: grace }) {
      // On Android the picker hides the page; the QR-image picker must not
      // lock the vault mid-pick. Playwright intercepts the chooser, so no
      // native dialog opens.
      const row = await openEntry(page, ENTRY);
      const chooser = page.waitForEvent("filechooser");
      await row.getByRole("button", { name: "Scan QR image" }).click();
      await chooser;
      await expectNoLockWhileHidden(page, grace, "an open file picker");
      await closeEntry(row);
      // Back from the picker, the next hide locks as usual (next steps).
    },
  },
  {
    name: "hidden page: locks on return once the grace period passed",
    async run({ page, state, hiddenLockSeconds: grace }) {
      // Mobile browsers freeze a hidden page, so its timers never fire:
      // move the clock without running timers, then come back.
      await setHidden(page, true);
      await cover(page).waitFor();
      const now = await page.evaluate(() => Date.now());
      await page.clock.setSystemTime(now + (grace + 5) * 1000);
      await setHidden(page, false);
      await unlockHeading(page).waitFor({ timeout: 10_000 });
      assert(!(await cover(page).count()), "cover left over the unlock screen");
      await unlock(page, state, { pickFile: false });
    },
  },
  {
    name: "hidden page: locks while hidden after the grace period",
    async run({ page, hiddenLockSeconds: grace }) {
      await setHidden(page, true);
      await cover(page).waitFor();
      await page.clock.fastForward((grace - 1) * 1000);
      assert(!(await isLocked(page)), "locked before the grace period ended");
      await page.clock.fastForward(2_000);
      await unlockHeading(page).waitFor({ timeout: 10_000 });
      await setHidden(page, false);
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
