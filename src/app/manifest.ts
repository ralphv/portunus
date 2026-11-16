import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Portunus",
    short_name: "Portunus",
    description:
      "Self-hosted, zero-knowledge secrets manager backed by Google Drive",
    start_url: "/",
    display: "standalone",
    background_color: "#f9f9ff",
    theme_color: "#3f5f90",
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
