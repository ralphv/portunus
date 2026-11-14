// Portunus service worker — makes the app shell work offline (installable,
// loads without connectivity). Vault *data* offline is handled separately by
// the ciphertext cache in localStorage (see src/lib/vault-session.ts).
//
// Strategy:
//   /_next/static/**   → cache-first (content-hashed, immutable)
//   navigations        → network-first, fall back to cached page
//   /api/**            → never intercepted (auth/Drive must stay live)
// One cache per build (RegisterSW passes it as ?v=); activate drops the rest.
const BUILD = new URL(location.href).searchParams.get("v");
// Prefix shared with SW_CACHE_PREFIX in src/constants.ts.
const CACHE = `portunus-shell-${BUILD || "v1"}`;

// The page that registered this build was loaded through the previous SW, so
// its page and chunks sit in the old cache. Seed the new cache before activate
// deletes the old one: this build's assets (?dpl=<BUILD>) plus a fresh "/",
// so the app still loads offline right after an upgrade.
async function seedCache() {
  const cache = await caches.open(CACHE);
  if (BUILD) {
    const marker = `dpl=${encodeURIComponent(BUILD)}`;
    for (const key of await caches.keys()) {
      if (key === CACHE) continue;
      const old = await caches.open(key);
      for (const req of await old.keys()) {
        if (!req.url.includes(marker)) continue;
        const res = await old.match(req);
        if (res) await cache.put(req, res);
      }
    }
  }
  await cache.add(new Request("/", { cache: "reload" })).catch(() => {});
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(seedCache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit ?? caches.match("/")),
        ),
    );
  }
});
