import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "vitepress";

// The app's keyhole emblem is the site logo. Copied (not committed) from the
// app's public/ so it stays in sync with `npm run palette`.
const publicDir = new URL("../public/", import.meta.url);
mkdirSync(publicDir, { recursive: true });
copyFileSync(
  new URL("../../public/icons/icon-192.png", import.meta.url),
  new URL("logo.png", publicDir),
);

const repo = "https://github.com/ralphv/portunus";
// Served from the custom domain https://portunus-vault.app (docs/public/CNAME),
// so the site lives at the root.

// Plain .mjs (not .mts) so the root tsconfig's `**/*.mts` glob doesn't pull
// this file into the app's `next build` type-check, where vitepress isn't
// installed.
export default defineConfig({
  title: "Portunus",
  description:
    "Self-hosted, stateless, zero-knowledge secrets manager backed by your own Google Drive.",
  cleanUrls: true,
  lastUpdated: true,
  // screenshots/ is image assets only (also used by the repo README).
  srcExclude: ["screenshots/**", "scripts/**"],
  head: [["link", { rel: "icon", type: "image/png", href: "/logo.png" }]],
  themeConfig: {
    logo: "/logo.png",
    nav: [
      { text: "Features", link: "/features" },
      { text: "Install", link: "/install" },
      { text: "Demo", link: "/demo" },
      { text: "Security", link: "/security" },
    ],
    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "Features", link: "/features" },
          { text: "Demo", link: "/demo" },
          { text: "Install", link: "/install" },
          { text: "Google OAuth setup", link: "/google-oauth" },
          { text: "Running over HTTPS", link: "/https" },
          { text: "Configuration", link: "/configuration" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Security model", link: "/security" },
          { text: "FAQ", link: "/faq" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repo }],
    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    search: { provider: "local" },
    footer: {
      message: `Released under the <a href="${repo}/blob/main/LICENSE">AGPL-3.0</a> license.`,
    },
  },
});
