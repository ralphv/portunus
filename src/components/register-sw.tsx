"use client";

import { useEffect } from "react";

// Registers the service worker that makes the app shell installable/offline.
// Production only — a caching SW would fight Turbopack HMR in dev.
export function RegisterSW() {
  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" &&
      "serviceWorker" in navigator
    ) {
      // A new build re-registers the SW under a new URL, which installs it
      // with a fresh cache and drops the previous build's cached shell.
      const build = process.env.NEXT_PUBLIC_PORTUNUS_BUILD_ID ?? "";
      navigator.serviceWorker
        .register(`/sw.js?v=${encodeURIComponent(build)}`)
        .catch(() => {});
    }
  }, []);
  return null;
}
