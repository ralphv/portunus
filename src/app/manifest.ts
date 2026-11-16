import type { MetadataRoute } from "next";

import { THEME_COLOR_LIGHT } from "@/constants";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Portunus",
    short_name: "Portunus",
    description:
      "Self-hosted, zero-knowledge secrets manager backed by Google Drive",
    start_url: "/",
    display: "standalone",
    // The light surface for both, matching the light theme-color meta, so
    // the installed app's title bar doesn't jump colour when the page loads.
    // (A manifest can't vary by colour scheme.)
    background_color: THEME_COLOR_LIGHT,
    theme_color: THEME_COLOR_LIGHT,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
