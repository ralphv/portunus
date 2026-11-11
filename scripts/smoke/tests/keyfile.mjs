// "Password and keyfile required" and "Per-device keyfile": each secret alone
// is refused, the recovery code stands in for the file, and the keyfile can
// be installed in / removed from the browser.

import {
  DEMO_EMAIL,
  ENTRY,
  KEYFILE_STORAGE_KEY,
  PASSWORD,
  assert,
  fillUnlock,
  lockAndReload,
  menu,
  storage,
  unlock,
  unlockButton,
  unlockHeading,
  vaultOpen,
} from "../helpers.mjs";

const WRONG = "Wrong password or keyfile.";

// On-screen keyboard (src/constants.ts, src/components/onscreen-keyboard.tsx).
const SHOW_KEYBOARD = "Show on-screen keyboard";
const KEYBOARD_STORAGE_KEY = "portunus.onscreen-keyboard";
const PHONES = [
  [390, 844],
  [393, 852],
  [412, 915],
];

const keyboard = (page) => page.getByRole("group", { name: "On-screen keyboard" });
const masterField = (page) => page.getByLabel("Master password", { exact: true });

// The character keys in grid order (Shift ⇧ and Backspace ⌫ aren't ASCII).
async function keyOrder(page) {
  const texts = await keyboard(page).getByRole("button").allTextContents();
  return texts.filter((t) => /^[\x21-\x7e]$/.test(t));
}

// Enters `text` by clicking keys only, switching pages and Shift as needed.
async function typeOnScreen(page, text) {
  const kb = keyboard(page);
  let symbols = false;
  let shift = false;
  for (const c of text) {
    if (c === " ") {
      await kb.getByRole("button", { name: "Space", exact: true }).click();
      continue;
    }
    const wantSymbols = !/[a-z0-9]/i.test(c);
    if (wantSymbols !== symbols) {
      await kb.getByRole("button", { name: symbols ? "Letters and digits" : "Symbols" }).click();
      symbols = wantSymbols;
    }
    const wantShift = /[A-Z]/.test(c);
    if (!symbols && wantShift !== shift) {
      await kb.getByRole("button", { name: "Shift" }).click();
      shift = wantShift;
    }
    await kb.getByRole("button", { name: c, exact: true }).click();
  }
}

export const keyfileTests = [
  {
    name: "wrong password is refused",
    async run({ page }) {
      await lockAndReload(page);
      // The installed keyfile loads by itself.
      await page.getByText(/^Key .+ loaded$/).waitFor();
      await page.getByText(`Signed in as ${DEMO_EMAIL}`).waitFor();
      await page.locator('input[type="password"]').fill("not the master password");
      await unlockButton(page).click();
      await page.getByText(WRONG).waitFor({ timeout: 30_000 });
      await unlockHeading(page).waitFor();
    },
  },
  {
    name: "master password stays out of the DOM",
    async run({ page }) {
      const input = page.locator('input[type="password"]');
      await input.fill(PASSWORD);
      assert((await input.getAttribute("value")) === null, "master password input has a value attribute");
      assert(!(await page.content()).includes(PASSWORD), "master password appears in the page HTML");
      // The eye button reveals it (still no value attribute) and hides it again.
      await page.getByRole("button", { name: "Show password" }).click();
      const shown = page.locator('input[aria-label="Master password"]');
      assert((await shown.getAttribute("type")) === "text", "Show password didn't reveal it");
      assert((await shown.inputValue()) === PASSWORD, "revealed input lost the password");
      assert(!(await page.content()).includes(PASSWORD), "revealed master password appears in the page HTML");
      await page.getByRole("button", { name: "Hide password" }).click();
      assert((await shown.getAttribute("type")) === "password", "Hide password didn't mask it");
    },
  },
  {
    name: "wrong keyfile is refused",
    async run({ page, state }) {
      // The keyfile from the refused second create: valid, but not this vault's.
      await page.locator('input[type="file"]').setInputFiles(state.otherKeyfilePath);
      await page.getByText(/^Key .+ loaded$/).waitFor();
      await page.locator('input[type="password"]').fill(PASSWORD);
      await unlockButton(page).click();
      await page.getByText(WRONG).waitFor({ timeout: 30_000 });
    },
  },
  {
    name: "remove key from the unlock screen",
    async run({ page }) {
      await page.reload();
      await unlockHeading(page).waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "Remove key from this browser" }).click();
      await page.getByRole("button", { name: "Choose portunus.key…" }).waitFor();
      assert((await storage(page, KEYFILE_STORAGE_KEY)) === null, "keyfile still installed after Remove key");
    },
  },
  {
    name: "unlock with recovery code",
    async run({ page, state }) {
      await page.getByRole("button", { name: "Restore from recovery code instead" }).click();
      await page.getByPlaceholder("XXXXX-XXXXX-…").fill(state.recoveryCode);
      await page.getByRole("button", { name: "Use recovery code" }).click();
      await page.getByText(`Key ${state.kid} loaded`).waitFor();
      await page.locator('input[type="password"]').fill(PASSWORD);
      await unlockButton(page).click();
      await vaultOpen(page);
      await page.getByText(ENTRY).first().waitFor();
      assert((await storage(page, KEYFILE_STORAGE_KEY)) !== null, "recovered keyfile not installed");
    },
  },
  {
    name: "installed keyfile unlocks without the file",
    async run({ page, state }) {
      await lockAndReload(page);
      await unlock(page, state, { pickFile: false });
    },
  },
  {
    name: "remove key from the menu",
    async run({ page, state }) {
      await menu(page, "Remove key");
      assert((await storage(page, KEYFILE_STORAGE_KEY)) === null, "keyfile still installed after Remove key");
      await lockAndReload(page);
      await page.getByRole("button", { name: "Choose portunus.key…" }).waitFor();
      // Unlocking with the file installs it again (the checkbox defaults on).
      await fillUnlock(page, state);
      await unlockButton(page).click();
      await vaultOpen(page);
    },
  },
  {
    name: "on-screen keyboard enters the password",
    async run({ page }) {
      await lockAndReload(page);
      await page.getByText(/^Key .+ loaded$/).waitFor();
      const field = masterField(page);
      await page.getByRole("button", { name: SHOW_KEYBOARD }).click();
      await keyboard(page).waitFor();
      assert((await field.getAttribute("inputmode")) === "none", "phone keyboard not suppressed while the on-screen one is open");

      const before = await keyOrder(page);
      assert(before.length === 36, `expected 36 letter/digit keys, got ${before.length}`);
      await keyboard(page).getByRole("button", { name: "Shuffle keys" }).click();
      const after = await keyOrder(page);
      assert([...after].sort().join("") === [...before].sort().join(""), "Shuffle changed the set of keys");
      assert(after.join("") !== before.join(""), "Shuffle kept the same layout");

      // Uppercase + a symbol, then Backspace them away.
      await typeOnScreen(page, `${PASSWORD}Q~`);
      assert((await field.inputValue()) === `${PASSWORD}Q~`, "on-screen keys entered the wrong text");
      await keyboard(page).getByRole("button", { name: "Backspace", exact: true }).click();
      await keyboard(page).getByRole("button", { name: "Backspace", exact: true }).click();
      assert((await field.inputValue()) === PASSWORD, "Backspace didn't delete the last characters");
      assert(await field.evaluate((el) => el === document.activeElement), "a key press took focus from the password field");
      assert((await field.getAttribute("value")) === null, "the on-screen keyboard wrote a value attribute");
      assert(!(await page.content()).includes(PASSWORD), "master password found in the page HTML");

      await unlockButton(page).click();
      await vaultOpen(page);
    },
  },
  {
    name: "on-screen keyboard remembered per device",
    async run({ page }) {
      await lockAndReload(page);
      await keyboard(page).waitFor();
      assert((await storage(page, KEYBOARD_STORAGE_KEY)) === "open", "open keyboard not remembered");
      await keyboard(page).getByRole("button", { name: "Done" }).click();
      await keyboard(page).waitFor({ state: "detached" });
      assert((await masterField(page).getAttribute("inputmode")) === null, "phone keyboard still suppressed after Done");
      assert((await storage(page, KEYBOARD_STORAGE_KEY)) === null, "closed keyboard still remembered as open");
      await page.reload();
      await unlockHeading(page).waitFor({ timeout: 30_000 });
      assert((await keyboard(page).count()) === 0, "keyboard reopened after Done + reload");
    },
  },
  {
    name: "on-screen keyboard fits a phone",
    async run({ page, state }) {
      const desktop = page.viewportSize();
      await page.getByRole("button", { name: SHOW_KEYBOARD }).click();
      try {
        for (const [width, height] of PHONES) {
          await page.setViewportSize({ width, height });
          for (const symbols of [false, true]) {
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            assert(overflow <= 0, `${width}×${height}: page scrolls sideways by ${overflow}px`);
            const keys = await keyboard(page)
              .getByRole("button")
              .evaluateAll((els) =>
                els.map((el) => {
                  const r = el.getBoundingClientRect();
                  return { text: el.textContent, left: r.left, right: r.right, width: r.width, height: r.height };
                }),
              );
            for (const k of keys) {
              assert(k.left >= 0 && k.right <= width, `${width}×${height}: "${k.text}" key off screen`);
              if (k.text !== "↻ Shuffle")
                assert(k.width >= 28 && k.height >= 40, `${width}×${height}: "${k.text}" key too small (${Math.round(k.width)}×${Math.round(k.height)})`);
            }
            await keyboard(page)
              .getByRole("button", { name: symbols ? "Letters and digits" : "Symbols" })
              .click();
          }
        }
      } finally {
        await page.setViewportSize(desktop);
      }
      await keyboard(page).getByRole("button", { name: "Done" }).click();
      await unlock(page, state, { pickFile: false });
    },
  },
];
