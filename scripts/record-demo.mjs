// Records the README demo GIF + screenshots against a running demo-mode server:
//
//   PORTUNUS_DEMO_MODE=1 npm run dev        # fresh process = empty in-memory vault
//   node scripts/record-demo.mjs            # BASE_URL=http://localhost:3000 by default
//
// Drives landing → sign-in → create vault → recovery code/keyfile → unlock →
// add entries (auto site icons + icon picker, password strength meter,
// silent Have-I-Been-Pwned check, live TOTP codes, SSO provider, labels) →
// label filter → save → search/copy. Writes docs/screenshots/{landing,
// create-vault,unlock,entry-edit,entries}.png and docs/screenshots/demo.gif
// (needs ffmpeg).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT_DIR = new URL("../docs/screenshots/", import.meta.url).pathname;
const VIEWPORT = { width: 1100, height: 820 };
const GIF_WIDTH = 800;
const GIF_FPS = 10;
const PASSWORD = "correct horse battery staple";
// Any valid base32 secret — the point is the live ticking code, not the value.
const TOTP_SECRET = "JBSWY3DPEHPK3PXP";

// Entry-editor labels aren't for-associated — select by label text.
const field = (row, label) =>
  row.locator(
    `xpath=.//label[normalize-space()='${label}']/following-sibling::div[1]//input[1]`,
  );
const addLabel = async (row, label) => {
  const input = row.locator('input[aria-label="Add label"]');
  await typeSlow(input, label);
  await input.press("Enter");
};

const workDir = mkdtempSync(join(tmpdir(), "portunus-demo-"));
const videoDir = join(workDir, "video");
mkdirSync(OUT_DIR, { recursive: true });

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) =>
  page.screenshot({ path: join(OUT_DIR, `${name}.png`) });

async function typeSlow(locator, text) {
  await locator.click();
  await locator.pressSequentially(text, { delay: 35 });
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  colorScheme: "dark",
  acceptDownloads: true,
  recordVideo: { dir: videoDir, size: VIEWPORT },
});
await context.grantPermissions(["clipboard-read", "clipboard-write"], {
  origin: BASE_URL,
});
// Hide the Next.js dev-tools badge (demo mode only runs under `next dev`).
await context.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.append(style);
  });
});
const page = await context.newPage();
page.on("dialog", (d) => d.accept());

try {
  // Landing
  await page.goto(BASE_URL);
  await page.getByRole("button", { name: "Sign in with Google" }).waitFor();
  await pause(1200);
  await shot(page, "landing");

  // Sign in (demo provider — no Google round trip)
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  const createHeading = page.getByRole("heading", { name: "Create your vault" });
  await createHeading.waitFor({ timeout: 30_000 }).catch(() => {
    throw new Error(
      "Expected the create-vault flow. Restart the demo server for an empty in-memory vault.",
    );
  });
  await pause(800);

  // Create vault: master password
  const pw = page.locator('input[type="password"]');
  await typeSlow(pw.nth(0), PASSWORD);
  await typeSlow(pw.nth(1), PASSWORD);
  await pause(400);
  await page.getByRole("button", { name: "Continue" }).click();

  // Recovery code + keyfile
  await page.getByRole("heading", { name: "Save your keyfile" }).waitFor();
  await page.getByText(/^[0-9A-Z]{4,}(-[0-9A-Z]+)+$/).waitFor({ timeout: 30_000 });
  await pause(1000);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download portunus.key" }).click(),
  ]);
  const keyfilePath = join(workDir, "portunus.key");
  await download.saveAs(keyfilePath);
  // Leave the keyfile uninstalled so the unlock step shows the file picker.
  await page.getByLabel("Also install the keyfile in this browser").uncheck();
  await page.getByLabel(/I have saved the keyfile/).check();
  await pause(600);
  await shot(page, "create-vault");
  await page.getByRole("button", { name: "Create vault" }).click();

  // Vault is open — lock it to demonstrate unlocking.
  await page.getByPlaceholder("Search entries…").waitFor({ timeout: 60_000 });
  await pause(1000);
  await page.getByRole("button", { name: "Menu" }).click();
  await pause(500);
  await page.getByRole("menuitem", { name: "Lock" }).click();

  // Unlock: password + keyfile
  await page.getByRole("heading", { name: "Unlock vault" }).waitFor();
  await pause(600);
  await typeSlow(page.locator('input[type="password"]'), PASSWORD);
  await page.locator('input[type="file"]').setInputFiles(keyfilePath);
  await page.getByText(/^Key .+ loaded$/).waitFor();
  await pause(800);
  await shot(page, "unlock");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page.getByPlaceholder("Search entries…").waitFor({ timeout: 60_000 });
  await pause(800);

  // Entry 1: GitHub — weak password shows the strength meter + the silent
  // breach check, then Generate produces a strong one; the URL sets the site
  // icon; a TOTP secret yields a live ticking code; a label is added.
  await page.getByRole("button", { name: "+ Add" }).click();
  let row = page.locator("li").first();
  await typeSlow(field(row, "Name"), "GitHub");
  await typeSlow(field(row, "Username"), "octocat");
  await typeSlow(field(row, "Password"), "password");
  // Leaving the field fires the debounced HIBP check at once.
  await field(row, "Email").click();
  await page
    .getByText(/in breaches/)
    .waitFor({ timeout: 10_000 })
    .catch(() => {}); // offline HIBP → demo continues without the warning
  await pause(1000);
  await row.getByRole("button", { name: "Generate" }).click();
  await page.getByText(/to crack/).waitFor({ timeout: 30_000 });
  await typeSlow(field(row, "URL"), "https://github.com");
  // The icon follows the URL automatically; peek at the picker grid.
  await row.getByText(/Auto \(/).waitFor();
  await pause(400);
  await row.getByRole("button", { name: "Choose icon" }).click();
  await page.getByPlaceholder("Search icons…").waitFor();
  await pause(1200);
  await page.keyboard.press("Escape");
  await pause(300);
  const totpInput = row.locator('input[aria-label="Two-factor secret"]');
  await typeSlow(totpInput, TOTP_SECRET);
  await row.getByRole("button", { name: "Set", exact: true }).click();
  await row
    .locator('[aria-label^="Two-factor code"]')
    .waitFor({ timeout: 15_000 });
  await pause(600);
  await addLabel(row, "dev");
  await pause(400);
  await row.getByRole("button", { name: "show" }).first().click();
  await pause(700);
  await shot(page, "entry-edit");
  await row.getByRole("button", { name: "hide" }).first().click();
  await row.getByRole("button", { name: "Done", exact: true }).last().click();
  await pause(500);

  // Entry 2: AWS console — an email-shaped username fills an empty Email on
  // blur; the AWS icon comes from the console host.
  await page.getByRole("button", { name: "+ Add" }).click();
  row = page.locator("li").first();
  await typeSlow(field(row, "Name"), "AWS console");
  await typeSlow(field(row, "Username"), "admin@example.com");
  await field(row, "Email").click();
  await pause(700);
  await row.getByRole("button", { name: "Generate" }).click();
  await page.getByText(/to crack/).waitFor({ timeout: 30_000 });
  await typeSlow(field(row, "URL"), "https://console.aws.amazon.com");
  await pause(400);
  await addLabel(row, "work");
  await pause(300);
  await row.getByRole("button", { name: "Done", exact: true }).last().click();
  await pause(500);

  // Entry 3: Notion — SSO provider combobox → "sso · Google" chip.
  await page.getByRole("button", { name: "+ Add" }).click();
  row = page.locator("li").first();
  await typeSlow(field(row, "Name"), "Notion");
  await typeSlow(field(row, "Username"), "me@example.com");
  await typeSlow(row.locator('input[list="sso-provider-presets"]'), "Google");
  await row.getByRole("button", { name: "Generate" }).click();
  await typeSlow(field(row, "URL"), "https://www.notion.so");
  await pause(400);
  await addLabel(row, "work");
  await pause(300);
  await row.getByRole("button", { name: "Done", exact: true }).last().click();
  await page.getByText("sso · Google").waitFor();
  await pause(600);

  // Label filter chips narrow the list in one click.
  await page
    .getByRole("group", { name: "Filter by label" })
    .getByRole("button", { name: "work" })
    .click();
  await page.getByText("2 entries").waitFor();
  await pause(1400);
  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByText("3 entries").waitFor();
  await pause(400);

  // Save (re-enter master password)
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await typeSlow(
    page.getByRole("heading", { name: "Confirm master password to save" })
      .locator("..")
      .locator('input[type="password"]'),
    PASSWORD,
  );
  await page.getByRole("button", { name: "Save to Drive" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).and(page.locator(":disabled")).waitFor();
  await pause(1000);
  await shot(page, "entries");

  // Search + copy
  await typeSlow(page.getByPlaceholder("Search entries…"), "git");
  await pause(800);
  await page.getByRole("button", { name: "Copy password" }).first().click();
  // The button's accessible name flips to "Copied" — match the visible
  // feedback text, which is not part of the accessible name.
  await page.getByText("copied ✓").waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  if (!clip) throw new Error("Clipboard copy failed");
  await pause(1500);
} finally {
  await context.close();
  await browser.close();
}

const [video] = readdirSync(videoDir).filter((f) => f.endsWith(".webm"));
const gifPath = join(OUT_DIR, "demo.gif");
execFileSync(
  "ffmpeg",
  [
    "-y", "-loglevel", "error",
    "-i", join(videoDir, video),
    "-vf",
    `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];` +
      "[a]palettegen=max_colors=128:stats_mode=diff[p];" +
      "[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    gifPath,
  ],
  { stdio: "inherit" },
);
rmSync(workDir, { recursive: true, force: true });
console.log(`Wrote ${gifPath} and screenshots to ${OUT_DIR}`);
