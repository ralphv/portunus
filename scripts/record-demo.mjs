// Records the README demo GIF + screenshots against a running demo-mode server:
//
//   PORTUNUS_DEMO_MODE=1 npm run dev        # fresh process = empty in-memory vault
//   node scripts/record-demo.mjs            # BASE_URL=http://localhost:3000 by default
//
// Drives landing → sign-in → create vault → recovery code/keyfile → unlock →
// add/search/copy entries. Writes docs/screenshots/{landing,create-vault,
// unlock,entry-edit,entries}.png and docs/screenshots/demo.gif (needs ffmpeg).

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

const ENTRIES = [
  { name: "GitHub", username: "octocat", url: "https://github.com" },
  { name: "AWS console", username: "admin@example.com", url: "https://console.aws.amazon.com" },
  { name: "Home Wi-Fi", username: "portunus-5g", url: "" },
];

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

  // Add entries
  for (const [i, entry] of ENTRIES.entries()) {
    await page.getByRole("button", { name: "+ Add" }).click();
    const row = page.locator("li").first();
    const inputs = row.locator("input");
    await typeSlow(inputs.nth(0), entry.name);
    await typeSlow(inputs.nth(1), entry.username);
    await row.getByRole("button", { name: "Generate" }).click();
    await pause(300);
    if (entry.url) await typeSlow(inputs.nth(4), entry.url);
    if (i === ENTRIES.length - 1) {
      await row.getByRole("button", { name: "show" }).click();
      await pause(600);
      await shot(page, "entry-edit");
      await row.getByRole("button", { name: "hide" }).click();
    }
    await pause(300);
    await row.getByRole("button", { name: "Done" }).click();
    await pause(400);
  }

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
  await page.getByRole("button", { name: "copy pass" }).first().click();
  await page.getByRole("button", { name: "copied ✓" }).waitFor();
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
