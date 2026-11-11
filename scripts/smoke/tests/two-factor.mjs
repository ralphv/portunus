// "Two-factor vault delivery": enable, unlock with a code (a wrong code, a
// wrong password or both are refused with the same message), disable.

import {
  ENTRY,
  PASSWORD,
  assert,
  closeSecurity,
  fillUnlock,
  lockAndReload,
  openSecurity,
  unlockButton,
  vaultOpen,
  assertPasswordsRevealable,
} from "../helpers.mjs";
import { freshTotpCode, totpCode } from "../totp.mjs";

// Deliberately the same for a wrong code and a wrong password.
const UNLOCK_FAILED = "Wrong password, keyfile or two-factor code.";
const WRONG_PASSWORD = "Wrong password or keyfile.";
// A code from an hour ago: valid format, wrong value.
const staleCode = (secret) => totpCode(secret, Date.now() - 3_600_000);
const passwordInput = (page) => page.locator('input[aria-label="Master password"]');
const codeInput = (page) => page.locator("#vault-totp-code");

// After a refused attempt: the generic message, and the code field is still
// there but emptied (the server won't take the same code twice).
async function expectGenericRefusal(page) {
  await page.getByText(UNLOCK_FAILED).waitFor({ timeout: 30_000 });
  await page.getByRole("heading", { name: "Unlock vault" }).waitFor();
  await codeInput(page).waitFor();
  assert((await codeInput(page).inputValue()) === "", "spent code not cleared");
  assert(!(await page.getByText(WRONG_PASSWORD, { exact: true }).count()), "error says which one was wrong");
}

const activeLabel = (page) =>
  page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.id);

export const twoFactorTests = [
  {
    name: "enable two-factor",
    async run({ page, state }) {
      await openSecurity(page);
      const setup = page.locator("form", {
        has: page.getByRole("button", { name: "Set up two-factor" }),
      });
      await setup.locator('input[type="password"]').fill(PASSWORD);
      await setup.getByRole("button", { name: "Set up two-factor" }).click();
      await page.getByRole("img", { name: "Two-factor setup QR code" }).waitFor();
      const key = await page.locator("code").filter({ hasText: /^[A-Z2-7 ]{16,}$/ }).textContent();
      state.totpSecret = key.replace(/\s+/g, "");
      await page.locator("#vault-2fa-confirm").fill(await freshTotpCode(state.totpSecret, state));
      await page.getByRole("button", { name: "Enable", exact: true }).click();
      await page.getByText("Two-factor authentication enabled.").waitFor({ timeout: 30_000 });
      // Not added to state.secrets: the server checks these codes, so this
      // one secret is sent to it by design (README "Two-factor vault delivery").
      await closeSecurity(page);
    },
  },
  {
    name: "unlock asks for a two-factor code",
    // The vault fetch is refused until a code is entered.
    allowHttp: [{ status: 401, method: "GET", path: "/api/vault" }],
    async run({ page, state }) {
      await lockAndReload(page);
      await page.locator("#vault-totp-code").waitFor();
      await fillUnlock(page, state);
    },
  },
  {
    name: "show password keeps focus and Tab goes to the code",
    async run({ page }) {
      await passwordInput(page).focus();
      await page.getByRole("button", { name: "Show password" }).click();
      assert((await passwordInput(page).getAttribute("type")) === "text", "Show password didn't reveal it");
      assert((await activeLabel(page)) === "Master password", "Show password moved focus off the password");
      await page.getByRole("button", { name: "Hide password" }).click();
      assert((await passwordInput(page).getAttribute("type")) === "password", "Hide password didn't mask it");
      assert((await activeLabel(page)) === "Master password", "Hide password moved focus off the password");
      // The eye button is skipped: Tab goes straight from the password to the code.
      await page.keyboard.press("Tab");
      assert((await activeLabel(page)) === "vault-totp-code", "Tab from the password didn't reach the code");
    },
  },
  {
    name: "wrong two-factor code is rejected",
    allowHttp: [{ status: 401, method: "POST", path: "/api/vault/unlock" }],
    async run({ page, state }) {
      await codeInput(page).fill(staleCode(state.totpSecret));
      await unlockButton(page).click();
      await expectGenericRefusal(page);
    },
  },
  {
    name: "wrong password and wrong code are rejected",
    allowHttp: [{ status: 401, method: "POST", path: "/api/vault/unlock" }],
    async run({ page, state }) {
      await passwordInput(page).fill("not the master password");
      await codeInput(page).fill(staleCode(state.totpSecret));
      await unlockButton(page).click();
      await expectGenericRefusal(page);
    },
  },
  {
    name: "wrong password with the right code is rejected",
    async run({ page, state }) {
      // The server accepts the code; the password fails in the browser.
      await passwordInput(page).fill("not the master password");
      await codeInput(page).fill(await freshTotpCode(state.totpSecret, state));
      await unlockButton(page).click();
      await expectGenericRefusal(page);
    },
  },
  {
    name: "unlock with two-factor code",
    async run({ page, state }) {
      // A fresh code still works after the refused attempts.
      await passwordInput(page).fill(PASSWORD);
      await codeInput(page).fill(await freshTotpCode(state.totpSecret, state));
      await unlockButton(page).click();
      await vaultOpen(page);
      await page.getByText(ENTRY).first().waitFor();
    },
  },
  {
    name: "disable two-factor",
    async run({ page }) {
      await openSecurity(page);
      const form = page.locator("form", {
        has: page.getByRole("button", { name: "Disable 2FA" }),
      });
      await assertPasswordsRevealable(form, "Disable 2FA form");
      await form.locator('input[type="password"]').fill(PASSWORD);
      await form.getByRole("button", { name: "Disable 2FA" }).click();
      await page.getByText("Two-factor authentication disabled.").waitFor({ timeout: 30_000 });
      await closeSecurity(page);
    },
  },
  {
    name: "unlock without a code after disabling",
    async run({ page, state }) {
      await lockAndReload(page);
      await fillUnlock(page, state, { password: "not the master password" });
      assert(!(await codeInput(page).count()), "two-factor code still requested after disabling 2FA");
      // Without two-factor the usual message is back, still with no code field.
      await unlockButton(page).click();
      await page.getByText(WRONG_PASSWORD, { exact: true }).waitFor({ timeout: 30_000 });
      assert(!(await codeInput(page).count()), "code field appeared after a wrong password");
      await passwordInput(page).fill(PASSWORD);
      await unlockButton(page).click();
      await vaultOpen(page);
      await page.getByText(ENTRY).first().waitFor();
    },
  },
];
