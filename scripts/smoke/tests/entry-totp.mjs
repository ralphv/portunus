// "Two-factor codes (TOTP)": per-entry secrets set by pasting a secret, an
// otpauth:// URI or a QR image; live codes with a countdown that turns red,
// copyable from the editor and the collapsed row.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import qrcode from "qrcode-generator";
import {
  assert,
  clipboardText,
  closeEntry,
  entryRow,
  openEntry,
  save,
} from "../helpers.mjs";
import { totpCode } from "../totp.mjs";

const SECRET_GITHUB = "JBSWY3DPEHPK3PXP";
const SECRET_NOTION = "KRSXG5CTMVRXEZLU";
const SECRET_SPACEY = "GEZDGNBVGY3TQOJQ";

// The codes an authenticator would accept around now (a step either side,
// in case a code rolls over mid-check).
const validCodes = (secret) => [-30_000, 0, 30_000].map((d) => totpCode(secret, Date.now() + d));

async function expectEditorCode(row, secret) {
  const view = row.locator('[aria-label^="Two-factor code "]');
  await view.waitFor({ timeout: 15_000 });
  const code = (await view.getAttribute("aria-label")).slice("Two-factor code ".length);
  assert(validCodes(secret).includes(code), `editor shows ${code}, not a current code`);
  const left = await row.locator('[aria-label$=" seconds left"]').getAttribute("aria-label");
  const seconds = Number.parseInt(left, 10);
  assert(seconds >= 1 && seconds <= 30, `countdown says "${left}"`);
}

const collapsedTotp = (page, name) => entryRow(page, name).getByRole("button", { name: /2FA:|copied/ });

async function expectCollapsedCode(page, name, secret) {
  const button = collapsedTotp(page, name);
  const text = await button.textContent();
  const m = /(\d{3}) (\d{3}) · (\d+)s/.exec(text);
  assert(m, `collapsed row shows "${text}"`);
  assert(validCodes(secret).includes(m[1] + m[2]), `collapsed row shows ${m[1]}${m[2]}, not a current code`);
  await button.click();
  await entryRow(page, name).getByText(/copied ✓/).waitFor();
  assert(validCodes(secret).includes(await clipboardText(page)), "collapsed 2FA button copied the wrong code");
}

async function pasteSecret(row, value) {
  await row.getByLabel("Two-factor secret").fill(value);
  await row.getByRole("button", { name: "Set", exact: true }).click();
}

export const entryTotpTests = [
  {
    name: "two-factor code from a pasted secret",
    async run({ page, state }) {
      const row = await openEntry(page, "GitHub");
      await pasteSecret(row, SECRET_GITHUB);
      await expectEditorCode(row, SECRET_GITHUB);
      const copyButton = row.getByRole("button", { name: "Copy two-factor code" });
      await copyButton.click();
      await copyButton.waitFor({ state: "detached" }); // renamed "Copied"
      assert(validCodes(SECRET_GITHUB).includes(await clipboardText(page)), "copied the wrong code");
      await closeEntry(row);
      await expectCollapsedCode(page, "GitHub", SECRET_GITHUB);
      state.secrets.push(SECRET_GITHUB);
    },
  },
  {
    name: "two-factor code from an otpauth:// URI",
    async run({ page, state }) {
      const row = await openEntry(page, "Notion");
      await pasteSecret(row, `otpauth://totp/Notion:me%40example.com?secret=${SECRET_NOTION}&issuer=Notion`);
      await expectEditorCode(row, SECRET_NOTION);
      await closeEntry(row);
      await expectCollapsedCode(page, "Notion", SECRET_NOTION);
      state.secrets.push(SECRET_NOTION);
    },
  },
  {
    name: "two-factor code from a QR image",
    async run({ page, workDir, state }) {
      const qr = qrcode(0, "M");
      qr.addData(`otpauth://totp/Spacey:smoke?secret=${SECRET_SPACEY}&issuer=Spacey`);
      qr.make();
      const image = join(workDir, "totp-qr.gif");
      writeFileSync(image, Buffer.from(qr.createDataURL(8, 16).split(",")[1], "base64"));
      const row = await openEntry(page, "Spacey");
      await row.locator('input[type="file"][accept="image/*"]').setInputFiles(image);
      await expectEditorCode(row, SECRET_SPACEY);
      await closeEntry(row);
      state.secrets.push(SECRET_SPACEY);
    },
  },
  {
    name: "invalid two-factor secret is refused",
    async run({ page }) {
      const row = await openEntry(page, "Weak entry");
      await pasteSecret(row, "not a secret!");
      await row.getByText("Not a valid TOTP secret or otpauth:// URI.").waitFor();
      await pasteSecret(row, "");
      assert(!(await row.locator('[aria-label^="Two-factor code "]').count()), "a code appeared anyway");
      await closeEntry(row);
    },
  },
  {
    name: "countdown turns red before the code expires",
    async run({ page }) {
      const urgent = collapsedTotp(page, "GitHub").locator("span.text-red-300").first();
      await urgent.waitFor({ timeout: 35_000 });
      const m = /· (\d+)s/.exec(await collapsedTotp(page, "GitHub").textContent());
      assert(m && Number(m[1]) <= 5, `red with ${m?.[1]}s left`);
    },
  },
  {
    name: "two-factor secrets saved",
    async run({ page }) {
      await save(page);
    },
  },
];
