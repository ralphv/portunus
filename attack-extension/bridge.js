// bridge.js — runs in the ISOLATED world (has chrome.* APIs).
//
// In a real attack this layer would relay MAIN-world captures to the
// background service worker, which has the extension's host permissions and
// is NOT bound by the page CSP's `connect-src 'self'` — so it could POST the
// stolen vault anywhere. For this authorized PoC we deliberately do NOT do
// that. We only count captures into extension storage so the exposure is
// demonstrable without any data leaving the machine.
window.addEventListener("__vault_harvester__", (e) => {
  try {
    const kind = e && e.detail && e.detail.kind;
    chrome.runtime?.sendMessage?.({ type: "capture", kind });
  } catch {}
});
