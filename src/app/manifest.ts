import type { MetadataRoute } from "next";

import { THEME_COLOR_LIGHT, THEME_COLOR_PRIMARY } from "@/constants";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Portunus",
    short_name: "Portunus",
    description:
      "Self-hosted, zero-knowledge secrets manager backed by Google Drive",
    start_url: "/",
    display: "standalone",
    background_color: THEME_COLOR_LIGHT,
    theme_color: THEME_COLOR_PRIMARY,
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
