// "Themes", "Auto-lock" (incl. the Lock button), "Hidden-page lock" and
// sign-out. Auto-lock fakes the page clock, so it runs last: from then on the
// page's time is ahead of real time.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEMO_EMAIL,
  ENTRY,
  THEME_STORAGE_KEY,
  assert,
  closeEntry,
  fillUnlock,
  searchBox,
  setSetting,
  settingChecked,
  unlockButton,
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
const pill = (page) => page.getByText(/^(locks in (\d+:)?\d+:\d\d|auto-lock paused)$/);
// Seconds left on the "locks in m:ss" pill.
async function pillSeconds(page) {
  // m:ss, or h:mm:ss from an hour up.
  const m = (await pill(page).textContent()).match(/^locks in (?:(\d+):)?(\d+):(\d\d)$/);
  assert(m, "no auto-lock countdown");
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
async function expectPillBetween(page, lo, hi, what) {
  // The pill ticks once a second; give it a moment to catch up.
  for (let i = 0; i < 20; i++) {
    const s = await pillSeconds(page).catch(() => -1);
    if (s >= lo && s <= hi) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`${what}: countdown shows ${await pill(page).textContent()}, expected ${lo}–${hi} s`);
}

// Hidden-page lock (src/components/hidden-cover.tsx). Headless pages are
// never really hidden, so the page's visibility is faked: the getters are
// overridden and a visibilitychange is dispatched, as a browser would.
const HIDDEN_COVER_CAPTION = "Hidden while you're away";
const BLUR_ON_FOCUS_LOSS = "Blur when the window loses focus";
async function setHidden(page, hidden) {
  await page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}
// Same for window focus: document.hasFocus() is overridden and the window
// gets the blur/focus event a browser would send.
async function setFocused(page, focused) {
  await page.evaluate((f) => {
    document.hasFocus = () => f;
    window.dispatchEvent(new Event(f ? "focus" : "blur"));
  }, focused);
}
const cover = (page) => page.locator("[data-hidden-cover]");
// The vault (its search box stands in for all of it) sits under an inert root.
const vaultInert = (page) =>
  page.evaluate(() => Boolean(document.querySelector('input[type="search"]')?.closest("[inert]")));
const isLocked = async (page) => (await unlockHeading(page).count()) > 0;
// Hidden, well past the grace period, yet still open (cover up), then back.
// `whileHidden` runs once the grace period has passed, before 10 s more.
async function expectNoLockWhileHidden(page, grace, why, whileHidden) {
  await setHidden(page, true);
  await cover(page).waitFor();
  await page.clock.fastForward((grace + 5) * 1000);
  if (whileHidden) {
    await whileHidden();
    await page.clock.fastForward(10_000);
  }
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
    async run({ page, state, autoLockSeconds: idle, hiddenLockSeconds: grace }) {
      assert(
        idle >= 70 && idle > grace + 10,
        "these steps need PORTUNUS_AUTO_LOCK_SECONDS >= 70 and > PORTUNUS_HIDDEN_LOCK_SECONDS + 10",
      );
      // Fake timers from here on; reload so the app starts under them.
      await page.clock.install();
      await page.reload();
      await unlockHeading(page).waitFor({ timeout: 30_000 });
      await unlock(page, state, { pickFile: false });
      await expectPillBetween(page, idle - 10, idle, "after unlock");
      await page.clock.fastForward((idle - 60) * 1000);
      await expectPillBetween(page, 50, 60, "a minute before");
      // Activity resets it.
      await page.mouse.move(10, 10);
      await page.mouse.move(200, 200);
      await page.clock.fastForward(1_000);
      await expectPillBetween(page, idle - 10, idle, "after activity");
      // Unsaved changes pause it — well past the limit, still open.
      const row = await openEntry(page, ENTRY);
      await notesField(row).fill("auto-lock waits for this");
      await closeEntry(row);
      await page.getByText("auto-lock paused").waitFor();
      await page.clock.fastForward((idle + 60) * 1000);
      assert(!(await unlockHeading(page).count()), "auto-locked with unsaved changes");
      await vaultOpen(page);
    },
  },
  {
    name: "auto-lock locks when idle",
    async run({ page, autoLockSeconds: idle }) {
      await save(page);
      await page.getByText(/^locks in (\d+:)?\d+:\d\d$/).waitFor();
      await page.clock.fastForward((idle + 1) * 1000);
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
      // Focus is in the search box when the page goes hidden.
      await searchBox(page).focus();
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
      // `inert` took focus away; coming back hands it back.
      assert(
        await searchBox(page).evaluate((el) => document.activeElement === el),
        "focus not restored to the search box after coming back",
      );
      await vaultOpen(page);
    },
  },
  {
    name: "focus loss: covered while away, clears on focus, locks after the grace period",
    async run({ page, state, hiddenLockSeconds: grace }) {
      // The page stays visible; only the window loses focus (another app or
      // window, the address bar, Android's Recent apps screen).
      await setFocused(page, false);
      await cover(page).waitFor();
      assert(await vaultInert(page), "vault not inert while the window is unfocused");
      await page.clock.fastForward((grace - 1) * 1000);
      assert(!(await isLocked(page)), "locked before the grace period ended (focus loss)");
      await setFocused(page, true);
      await cover(page).waitFor({ state: "detached" });
      assert(!(await vaultInert(page)), "vault still inert after focus came back");
      await vaultOpen(page);
      // Away past the grace period: locks while still unfocused.
      await setFocused(page, false);
      await cover(page).waitFor();
      await page.clock.fastForward((grace + 1) * 1000);
      await unlockHeading(page).waitFor({ timeout: 10_000 });
      await setFocused(page, true);
      await unlock(page, state, { pickFile: false });
    },
  },
  {
    name: "focus loss: can be turned off in Settings; a hidden page still covers",
    async run({ page, hiddenLockSeconds: grace }) {
      assert(await settingChecked(page, BLUR_ON_FOCUS_LOSS), `"${BLUR_ON_FOCUS_LOSS}" not on by default`);
      await setSetting(page, BLUR_ON_FOCUS_LOSS, false);
      // Off: the window loses focus well past the grace period — no cover,
      // still open.
      await setFocused(page, false);
      await page.clock.fastForward((grace + 5) * 1000);
      assert(!(await cover(page).count()), "cover shown on focus loss with the setting off");
      assert(!(await isLocked(page)), "locked on focus loss with the setting off");
      // A hidden page still covers.
      await setHidden(page, true);
      await cover(page).waitFor();
      await setHidden(page, false);
      await cover(page).waitFor({ state: "detached" });
      await setFocused(page, true);
      // Back on (the default), then save the settings change.
      await setSetting(page, BLUR_ON_FOCUS_LOSS, true);
      await save(page);
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
    async run({ page, workDir, hiddenLockSeconds: grace }) {
      // On Android the picker hides the page; the QR-image picker must not
      // lock the vault mid-pick — even when the chosen file arrives before
      // the page is visible again. Playwright intercepts the chooser, so no
      // native dialog opens. The image (1x1 GIF) holds no QR code.
      const image = join(workDir, "no-qr.gif");
      writeFileSync(image, Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
      const row = await openEntry(page, ENTRY);
      const chooserEvent = page.waitForEvent("filechooser");
      await row.getByRole("button", { name: "Scan QR image" }).click();
      const chooser = await chooserEvent;
      await expectNoLockWhileHidden(page, grace, "an open file picker", () => chooser.setFiles(image));
      await row.getByText("No QR code found in that image.").waitFor();
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
      // The user leaves while the unlock is still deriving the key: the
      // vault opens hidden and must come up covered.
      await fillUnlock(page, state, { pickFile: false });
      await setHidden(page, true);
      await unlockButton(page).click();
      await cover(page).waitFor({ timeout: 60_000 });
      assert(await vaultInert(page), "vault opened while hidden isn't inert");
      await setHidden(page, false);
      await cover(page).waitFor({ state: "detached" });
      await vaultOpen(page);
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
