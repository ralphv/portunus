// "Two-factor vault delivery": enable, unlock with a code (a wrong one is
// refused), disable.

import {
  ENTRY,
  PASSWORD,
  closeSecurity,
  fillUnlock,
  lockAndReload,
  openSecurity,
  unlockButton,
  vaultOpen,
} from "../helpers.mjs";
import { freshTotpCode, totpCode } from "../totp.mjs";

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
    name: "wrong two-factor code is rejected",
    allowHttp: [{ status: 401, method: "POST", path: "/api/vault/unlock" }],
    async run({ page, state }) {
      // A code from an hour ago: valid format, wrong value.
      await page.locator("#vault-totp-code").fill(totpCode(state.totpSecret, Date.now() - 3_600_000));
      await unlockButton(page).click();
      await page.getByText("That code didn't match").waitFor({ timeout: 30_000 });
      await page.getByRole("heading", { name: "Unlock vault" }).waitFor();
    },
  },
  {
    name: "unlock with two-factor code",
    async run({ page, state }) {
      await page.locator("#vault-totp-code").fill(await freshTotpCode(state.totpSecret, state));
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
      await fillUnlock(page, state);
      if (await page.locator("#vault-totp-code").count()) {
        throw new Error("two-factor code still requested after disabling 2FA");
      }
      await unlockButton(page).click();
      await vaultOpen(page);
      await page.getByText(ENTRY).first().waitFor();
    },
  },
];
