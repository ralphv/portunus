// Biometric unlock (WebAuthn passkey + PRF) — README "Biometric unlock".
// Chromium's virtual authenticator (CDP WebAuthn domain) stands in for a
// phone's fingerprint sensor: `isUserVerified` decides whether the check
// passes (one-way: once off, it never passes again), `hasPrf` whether the
// authenticator can do PRF.
//
// The server's flags decide which side runs: PORTUNUS_BIOMETRIC_UNLOCK=1
// (ctx.biometricUnlock) runs the feature tests, otherwise the "turned off"
// test; PORTUNUS_BIOMETRIC_SAVE_CONFIRM=0 (ctx.biometricSaveConfirm false)
// flips the save-dialog check.

import {
  NEW_PASSWORD,
  PASSWORD,
  addEntry,
  assert,
  closeSecurity,
  lock,
  lockAndReload,
  menu,
  openSecurity,
  saveButton,
  saveDialog,
  storage,
  unlock,
  unlockHeading,
  vaultOpen,
} from "../helpers.mjs";

export const DEVICE_UNLOCK_PREFIX = "portunus.device-unlock.";
export const DEVICE_UNLOCK_DISMISSED_PREFIX = "portunus.device-unlock-dismissed.";

const recordKey = (state) => DEVICE_UNLOCK_PREFIX + state.kid;
const dismissedKey = (state) => DEVICE_UNLOCK_DISMISSED_PREFIX + state.kid;

const biometricButton = (page) =>
  page.getByRole("button", { name: /^(Unlock with biometrics|Waiting for biometrics…)$/ });
const section = (page) => page.getByRole("region", { name: "Biometric unlock" });
const offer = (page) => page.getByRole("status").filter({ hasText: "Unlock with biometrics next time?" });

const setItem = (page, key, value) =>
  page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, value]);
const removeItem = (page, key) => page.evaluate((k) => localStorage.removeItem(k), key);

// One virtual authenticator per run, kept on `state`.
async function addAuthenticator(page, state, { prf = true } = {}) {
  state.cdp ??= await page.context().newCDPSession(page);
  await state.cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await state.cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: prf,
      automaticPresenceSimulation: true,
    },
  });
  state.authenticatorId = authenticatorId;
}

async function removeAuthenticator(state) {
  if (!state.authenticatorId) return;
  await state.cdp.send("WebAuthn.removeVirtualAuthenticator", {
    authenticatorId: state.authenticatorId,
  });
  state.authenticatorId = null;
}

const setUserVerified = (state, ok) =>
  state.cdp.send("WebAuthn.setUserVerified", {
    authenticatorId: state.authenticatorId,
    isUserVerified: ok,
  });

// Lock + reload, then a password unlock with the installed keyfile.
async function relock(page, state) {
  await lockAndReload(page);
  await unlock(page, state, { pickFile: false });
}

async function enable(page, password = PASSWORD) {
  await openSecurity(page);
  const form = section(page).locator("form");
  await form.locator('input[type="password"]').fill(password);
  await form.getByRole("button", { name: "Enable biometric unlock" }).click();
}

async function enableOk(page, state) {
  await enable(page);
  await section(page).getByText(/^On for this device since /).waitFor({ timeout: 60_000 });
  assert(await storage(page, recordKey(state)), "no biometric record stored after enabling");
  await closeSecurity(page);
}

async function changePassword(page, from, to) {
  const form = page.locator("form", {
    has: page.getByRole("button", { name: "Change password" }),
  });
  const inputs = form.locator('input[type="password"]');
  await inputs.nth(0).fill(from);
  await inputs.nth(1).fill(to);
  await inputs.nth(2).fill(to);
  await form.getByRole("button", { name: "Change password" }).click();
  await page.getByText("Password changed — vault re-encrypted.").waitFor({ timeout: 60_000 });
}

const off = [
  {
    name: "biometric unlock hidden when turned off",
    async run({ page, state }) {
      await addAuthenticator(page, state);
      // A record left from when the operator had it on is purged on load.
      await setItem(page, recordKey(state), '{"format":"portunus-device-unlock"}');
      await setItem(page, dismissedKey(state), "1");
      await relock(page, state);
      assert((await storage(page, recordKey(state))) === null, "stale biometric record survived with the feature off");
      assert((await storage(page, dismissedKey(state))) === null, "biometric offer answer survived with the feature off");
      assert(!(await offer(page).count()), "biometric set-up offer shown with the feature off");
      await openSecurity(page);
      assert(!(await section(page).count()), "Biometric unlock section shown with the feature off");
      await closeSecurity(page);
      await lockAndReload(page);
      assert(!(await biometricButton(page).count()), "biometric unlock button shown with the feature off");
      await unlock(page, state, { pickFile: false });
      await removeAuthenticator(state);
    },
  },
];

const on = [
  {
    name: "biometric unlock needs an authenticator with PRF",
    async run({ page, state }) {
      // No built-in authenticator: no unprompted offer, but the Security
      // section is there (a security key may still work).
      await relock(page, state);
      assert(!(await offer(page).count()), "set-up offer shown without a built-in authenticator");
      // An authenticator without PRF can't hold the key: refused, nothing stored.
      await addAuthenticator(page, state, { prf: false });
      await enable(page);
      await section(page)
        .getByText("This authenticator can't do biometric unlock (it lacks the PRF extension).")
        .waitFor({ timeout: 30_000 });
      assert((await storage(page, recordKey(state))) === null, "a record was stored for an authenticator without PRF");
      await closeSecurity(page);
      await removeAuthenticator(state);
    },
  },
  {
    name: "one-time biometric set-up offer",
    async run({ page, state }) {
      await addAuthenticator(page, state);
      await relock(page, state);
      await offer(page).waitFor({ timeout: 30_000 });
      await offer(page).getByRole("button", { name: "Not now" }).click();
      assert(!(await offer(page).count()), "Not now didn't hide the offer");
      assert((await storage(page, dismissedKey(state))) === "1", "Not now isn't remembered");
      await relock(page, state);
      await page.waitForTimeout(500);
      assert(!(await offer(page).count()), "offer came back after Not now");
      // Forget the answer: the offer is back, and Set up opens Security.
      await removeItem(page, dismissedKey(state));
      await relock(page, state);
      await offer(page).getByRole("button", { name: "Set up" }).click();
      await section(page).getByRole("button", { name: "Enable biometric unlock" }).waitFor();
      await closeSecurity(page);
    },
  },
  {
    name: "enable biometric unlock",
    async run({ page, state }) {
      await enable(page, "not the master password");
      await section(page).getByText("Wrong password.").waitFor({ timeout: 30_000 });
      assert((await storage(page, recordKey(state))) === null, "a record was stored after a wrong password");
      await closeSecurity(page);
      await enableOk(page, state);
      const record = JSON.parse(await storage(page, recordKey(state)));
      assert(record.format === "portunus-device-unlock" && record.kid === state.kid, "unexpected biometric record");
      const raw = await storage(page, recordKey(state));
      assert(!raw.includes(PASSWORD), "the master password is in the biometric record");
      assert((await storage(page, dismissedKey(state))) === null, "offer answer kept after enabling");
      assert(!(await offer(page).count()), "set-up offer still shown after enabling");
    },
  },
  {
    name: "unlock with biometrics",
    async run({ page }) {
      // After Lock nothing starts by itself: the button waits for a tap.
      await lock(page);
      await biometricButton(page).waitFor();
      await page.waitForTimeout(1_000);
      assert(await unlockHeading(page).isVisible(), "biometric unlock started by itself after Lock");
      // The phone keyboard stays down: the password field isn't focused.
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("type"));
      assert(focused !== "password", "the password field took focus next to biometric unlock");
      await biometricButton(page).click();
      await vaultOpen(page);
    },
  },
  {
    name: "biometric unlock starts when the page loads",
    async run({ page }) {
      // A reload (a fresh visit) runs the check without a tap.
      await page.reload();
      await vaultOpen(page);
    },
  },
  {
    name: "failed biometric check falls back to the password",
    async run({ page, state }) {
      await setUserVerified(state, false);
      // The automatic check on load fails quietly: no error, the button stays.
      await page.reload();
      await biometricButton(page).waitFor();
      await page.waitForTimeout(1_000);
      assert(
        !(await page.getByText(/^Biometric unlock didn't work/).count()),
        "a failed automatic check showed an error",
      );
      await biometricButton(page).click();
      await page
        .getByText("Biometric unlock didn't work. Try again or use your master password.")
        .waitFor({ timeout: 30_000 });
      assert(await storage(page, recordKey(state)), "a failed check removed the record");
      await unlock(page, state, { pickFile: false });
      // Chromium's virtual authenticator keeps refusing once user
      // verification was switched off, so swap in a fresh one: remove
      // biometric unlock (its passkey is gone with the old authenticator)
      // and enable it again.
      await removeAuthenticator(state);
      await addAuthenticator(page, state);
      await openSecurity(page);
      await section(page).getByRole("button", { name: "Remove biometric unlock" }).click();
      await section(page).getByRole("button", { name: "Enable biometric unlock" }).waitFor();
      await closeSecurity(page);
      await enableOk(page, state);
    },
  },
  {
    name: "save confirmed with biometrics",
    async run({ page, biometricSaveConfirm }) {
      await addEntry(page, { name: "Biometric entry", username: "bio" });
      await saveButton(page).click();
      const confirm = saveDialog(page).getByRole("button", { name: "Confirm with biometrics" });
      if (!biometricSaveConfirm) {
        assert(!(await confirm.count()), "Confirm with biometrics shown with PORTUNUS_BIOMETRIC_SAVE_CONFIRM=0");
        await saveDialog(page).locator('input[type="password"]').fill(PASSWORD);
        await page.getByRole("button", { name: "Save to Drive" }).click();
      } else {
        await confirm.click();
      }
      await saveDialog(page).waitFor({ state: "detached", timeout: 60_000 });
      await saveButton(page).and(page.locator(":disabled")).waitFor({ timeout: 30_000 });
    },
  },
  {
    name: "password change turns biometric unlock off",
    async run({ page, state }) {
      // This device: the change removes its record and offers to re-enable.
      await openSecurity(page);
      await changePassword(page, PASSWORD, NEW_PASSWORD);
      await section(page)
        .getByText("The password change turned biometric unlock off. Enable it again below.")
        .waitFor();
      assert((await storage(page, recordKey(state))) === null, "record kept after a password change");
      await changePassword(page, NEW_PASSWORD, PASSWORD);
      await closeSecurity(page);
      // Another device's record, made before the change, is stale. (Putting
      // this device's old record back wouldn't do: its passkey was dropped
      // with it.) Enable again, then point the record at another vault header.
      await enableOk(page, state);
      const record = JSON.parse(await storage(page, recordKey(state)));
      await setItem(page, recordKey(state), JSON.stringify({ ...record, headerDigest: "0".repeat(64) }));
      // The automatic check on reload finds the stale record.
      await page.reload();
      await page.getByText(/^Biometric unlock needs to be set up again/).waitFor({ timeout: 30_000 });
      assert((await storage(page, recordKey(state))) === null, "stale record kept");
      assert(!(await biometricButton(page).count()), "biometric button still shown for a stale record");
      await unlock(page, state, { pickFile: false });
    },
  },
  {
    name: "remove biometric unlock",
    async run({ page, state }) {
      // From the Security dialog.
      await enableOk(page, state);
      await openSecurity(page);
      await section(page).getByRole("button", { name: "Remove biometric unlock" }).click();
      await section(page).getByRole("button", { name: "Enable biometric unlock" }).waitFor();
      assert((await storage(page, recordKey(state))) === null, "Security → Remove kept the record");
      await closeSecurity(page);
      // From the unlock screen.
      await enableOk(page, state);
      await lock(page); // not a reload: that would unlock by itself
      await page.getByRole("button", { name: "Remove biometric unlock" }).click();
      await biometricButton(page).waitFor({ state: "detached" });
      assert((await storage(page, recordKey(state))) === null, "unlock-screen Remove kept the record");
      await unlock(page, state, { pickFile: false });
      // Removing the keyfile from the browser removes biometric unlock too.
      await enableOk(page, state);
      await menu(page, "Remove key");
      await page.waitForFunction((k) => localStorage.getItem(k) === null, recordKey(state));
      await lockAndReload(page);
      await unlock(page, state); // picks the file; installs it again
      await offer(page).getByRole("button", { name: "Not now" }).click();
      await removeItem(page, dismissedKey(state));
      await removeAuthenticator(state);
    },
  },
];

// Each step runs on one side of PORTUNUS_BIOMETRIC_UNLOCK and passes as a
// no-op on the other, so the SMOKE.md numbering is the same in every run.
const onlyWhen = (enabled, tests) =>
  tests.map((t) => ({
    ...t,
    async run(ctx) {
      if (ctx.biometricUnlock !== enabled) {
        console.log(`  (skipped: biometric unlock is ${ctx.biometricUnlock ? "on" : "off"})`);
        return;
      }
      await t.run(ctx);
    },
  }));

export const biometricTests = [...onlyWhen(false, off), ...onlyWhen(true, on)];
