"use client";

import { useEffect } from "react";

import { SW_CACHE_PREFIX } from "@/constants";

// Registers the service worker that makes the app shell installable/offline.
// Production only — a caching SW would fight Turbopack HMR in dev, so dev
// removes any left over from a production run instead.
export function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      // A SW left by a production run on this origin keeps serving its
      // cached /_next/static files, and dev chunk names don't change
      // between edits — e.g. a stale vault Worker without new methods.
      void unregisterServiceWorkers();
      return;
    }
    // A new build re-registers the SW under a new URL, which installs it
    // with a fresh cache and drops the previous build's cached shell.
    const build = process.env.NEXT_PUBLIC_PORTUNUS_BUILD_ID ?? "";
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(build)}`)
      .catch(() => {});
  }, []);
  return null;
}

async function unregisterServiceWorkers(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith(SW_CACHE_PREFIX)).map((k) => caches.delete(k)),
    );
    // The page itself may have been served from that cache: reload once,
    // now that nothing intercepts the requests.
    if (registrations.length) location.reload();
  } catch {
    // Storage blocked — nothing cached either.
  }
}
