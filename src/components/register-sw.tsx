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
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
