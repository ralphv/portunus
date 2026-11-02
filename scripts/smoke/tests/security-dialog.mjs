// Security dialog: keyfile / recovery-code export and master-password change
// (both behind re-entering the current password).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NEW_PASSWORD,
  PASSWORD,
  assert,
  closeSecurity,
  keyOf,
  lock,
  openSecurity,
  unlock,
  unlockButton,
  fillUnlock,
} from "../helpers.mjs";

const formWith = (page, button) =>
  page.locator("form", { has: page.getByRole("button", { name: button }) });

async function changePassword(page, from, to) {
  await openSecurity(page);
  const form = formWith(page, "Change password");
  const inputs = form.locator('input[type="password"]');
  await inputs.nth(0).fill(from);
  await inputs.nth(1).fill(to);
  await inputs.nth(2).fill(to);
  await form.getByRole("button", { name: "Change password" }).click();
  await page.getByText("Password changed — vault re-encrypted.").waitFor({ timeout: 60_000 });
  await closeSecurity(page);
}

export const securityDialogTests = [
  {
    name: "export keyfile and recovery code",
    async run({ page, workDir, state }) {
      await openSecurity(page);
      const form = formWith(page, "Reveal keyfile");
      await form.locator('input[type="password"]').fill("not the master password");
      await form.getByRole("button", { name: "Reveal keyfile" }).click();
      await form.getByText("Wrong password.").waitFor({ timeout: 30_000 });
      await form.locator('input[type="password"]').fill(PASSWORD);
      await form.getByRole("button", { name: "Reveal keyfile" }).click();
      await page.getByText(`Key ${state.kid}`, { exact: true }).waitFor({ timeout: 30_000 });
      const code = (await page.locator("code").filter({ hasText: /-/ }).first().textContent()).trim();
      assert(code === state.recoveryCode, "exported recovery code differs from the one shown at creation");
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Download portunus.key" }).click(),
      ]);
      const exported = join(workDir, "exported.key");
      await download.saveAs(exported);
      assert(keyOf(exported) === keyOf(state.keyfilePath), "exported keyfile holds a different key");
      assert(JSON.parse(readFileSync(exported, "utf8")).kid === state.kid, "exported keyfile has a different kid");
      await closeSecurity(page);
    },
  },
  {
    name: "change master password",
    async run({ page, state }) {
      await changePassword(page, PASSWORD, NEW_PASSWORD);
      await lock(page);
      // The old password no longer opens it; the new one does.
      await fillUnlock(page, state, { password: PASSWORD, pickFile: false });
      await unlockButton(page).click();
      await page.getByText("Wrong password or keyfile.").waitFor({ timeout: 30_000 });
      await unlock(page, state, { password: NEW_PASSWORD, pickFile: false });
      // Back to the original, which the remaining tests use.
      await changePassword(page, NEW_PASSWORD, PASSWORD);
    },
  },
];
