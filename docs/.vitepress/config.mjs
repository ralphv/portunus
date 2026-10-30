import { defineConfig } from "vitepress";

const repo = "https://github.com/ralphv/portunus";

// Plain .mjs (not .mts) so the root tsconfig's `**/*.mts` glob doesn't pull
// this file into the app's `next build` type-check, where vitepress isn't
// installed.
export default defineConfig({
  title: "Portunus",
  description:
    "Self-hosted, stateless, zero-knowledge secrets manager backed by your own Google Drive.",
  // Project Pages URL: https://ralphv.github.io/portunus/. Override with
  // DOCS_BASE=/ if the site moves to a custom domain.
  base: process.env.DOCS_BASE || "/portunus/",
  cleanUrls: true,
  lastUpdated: true,
  // screenshots/ is image assets only (also used by the repo README).
  srcExclude: ["screenshots/**", "scripts/**"],
  themeConfig: {
    nav: [
      { text: "Install", link: "/install" },
      { text: "Demo", link: "/demo" },
      { text: "Security", link: "/security" },
    ],
    sidebar: [
      {
        text: "Getting started",
        items: [
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
